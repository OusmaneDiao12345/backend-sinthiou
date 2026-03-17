const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// ⚙️ CONFIGURATION SENE-PAY (PRODUCTION)
// ==========================================
const SENEPAY_CONFIG = {
    // Tes clés récupérées de ta capture d'écran
    apiKey: 'pk_live_006ad6076e9081cea5dceeb1d61d60124ec995a75a380945', 
    apiSecret: 'sk_live_fdde37f876f68b1cdc27ea590ea5ffc3cb36caa597f22fad',
    baseUrl: 'https://api.sene-pay.com' 
};

app.get('/', (req, res) => res.send("✅ Serveur Proxy Sinthiou est EN LIGNE !"));

const CONTACT_FILE = path.join(__dirname, 'contact-requests.json');

app.post('/api/contact', (req, res) => {
    const { name, email, phone, topic, message } = req.body || {};

    if (!name || !phone || !message) {
        return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }

    const entry = {
        id: `contact_${Date.now()}`,
        name,
        email: email || null,
        phone,
        topic: topic || 'question',
        message,
        createdAt: new Date().toISOString()
    };

    try {
        let existing = [];
        if (fs.existsSync(CONTACT_FILE)) {
            existing = JSON.parse(fs.readFileSync(CONTACT_FILE, 'utf8') || '[]');
        }
        existing.push(entry);
        fs.writeFileSync(CONTACT_FILE, JSON.stringify(existing, null, 2));
    } catch (error) {
        console.error('Erreur sauvegarde contact', error);
    }

    res.json({ success: true, message: 'Contact enregistré' });
});

app.post('/api/initiate', async (req, res) => {
    console.log("\n=================================");
    console.log("📨 NOVA SOLICITAÇÃO DE PAGAMENTO");
    
    // Force 200 FCFA para passar em prod
    const amount = req.body.amount < 200 ? 200 : req.body.amount;
    
    // Corrige localhost se necessário
    let successUrl = req.body.returnUrl;
    if (successUrl.includes('127.0.0.1')) {
        successUrl = successUrl.replace('127.0.0.1', 'localhost');
    }

    console.log(`👤 Cliente : ${req.body.customerName}`);
    console.log(`💰 Montante : ${amount} FCFA`);
    console.log(`✅ URL Sucesso : ${successUrl}`);

    const apiUrl = `${SENEPAY_CONFIG.baseUrl}/api/v1/checkout/sessions`;
    console.log(`🔗 API URL: ${apiUrl}`);

    try {
        const response = await axios.post(apiUrl, {
            amount: amount,
            currency: "XOF",
            orderReference: "TICKET-" + Date.now(),
            description: `Ticket de football - ${req.body.customerName}`,
            successUrl: successUrl,
            cancelUrl: successUrl,
            webhookUrl: "https://footballfouta-backend.onrender.com/api/webhook/senepay",
            metadata: { 
                matchId: req.body.metadata?.matchId,
                type: 'ticket_purchase',
                customerPhone: req.body.customerPhone
            },
            expiresInMinutes: 60
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': SENEPAY_CONFIG.apiKey,
                'X-Api-Secret': SENEPAY_CONFIG.apiSecret
            }
        });

        console.log("📦 Réponse brute de l'API SenePay:", JSON.stringify(response.data, null, 2));
        
        const responseBody = response.data;

        if (responseBody && responseBody.checkoutUrl && responseBody.sessionToken) {
            console.log("✅ SUCCÈS ! Redirection vers :", responseBody.checkoutUrl);
            res.json({ success: true, data: {
                redirectUrl: responseBody.checkoutUrl,
                tokenPay: responseBody.sessionToken,
                checkoutUrl: responseBody.checkoutUrl,
                sessionToken: responseBody.sessionToken
            }});
        } else {
            console.log("⚠️ Réponse reçue mais données manquantes.");
            console.log("Réponse complète:", JSON.stringify(responseBody, null, 2));
            res.status(500).json({ success: false, message: "checkoutUrl ou sessionToken manquant" });
        }

    } catch (error) {
        console.log("❌ ÉCHEC");
        if (error.response) {
            console.log("🔴 Erreur API :", error.response.status);
            console.log("🔴 Message :", JSON.stringify(error.response.data, null, 2));
            res.status(error.response.status).json(error.response.data);
        } else {
            console.log("🔴 Erreur Réseau :", error.message);
            res.status(500).json({ success: false, message: "Erreur de connexion" });
        }
    }
});

app.get('/api/status/:token', async (req, res) => {
    try {
        const apiUrl = `${SENEPAY_CONFIG.baseUrl}/api/v1/checkout/sessions/${req.params.token}`;
        const response = await axios.get(apiUrl, {
            headers: {
                'X-Api-Key': SENEPAY_CONFIG.apiKey,
                'X-Api-Secret': SENEPAY_CONFIG.apiSecret
            }
        });
        res.json({ success: true, data: response.data });
    } catch (error) {
        console.error("Erro ao verificar status:", error.message);
        res.status(500).json({ success: false, message: "Erro ao verificar status" });
    }
});

// Webhook para receber notificações de pagamento do SenePay
app.post('/api/webhook/senepay', (req, res) => {
    console.log("\n=================================");
    console.log("🔔 WEBHOOK SENEPAY RECEBIDO");
    console.log("Evento:", req.body.event);
    console.log("Status da sessão:", req.body.status);
    console.log("Ordem:", req.body.orderReference);
    
    // Sempre responder 200 OK rápido
    res.status(200).json({ received: true });
    
    // Processar o webhook (não bloquear a resposta)
    if (req.body.event === 'checkout.session.completed') {
        console.log("✅ Pagamento APROVADO!");
        console.log("Transação ID:", req.body.transactionId);
        console.log("Valor pago:", req.body.amount, req.body.currency);
        
        // Aqui você atualizaria seu banco de dados para marcar o ticket como pago
        // updateTicket(req.body.orderReference, { status: 'paid' });
    } else if (req.body.event === 'checkout.session.failed') {
        console.log("❌ Pagamento FALHOU!");
    } else if (req.body.event === 'checkout.session.cancelled') {
        console.log("⚠️ Pagamento CANCELADO!");
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n✅ SERVEUR PRÊT SUR http://localhost:${PORT}`);
});