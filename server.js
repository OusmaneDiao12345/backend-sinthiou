const express = require('express');
const cors = require('cors');
const axios = require('axios');

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
    baseUrl: 'https://api.sene-pay.com/api/v1' 
};

app.get('/', (req, res) => res.send("✅ Serveur Proxy Sinthiou est EN LIGNE !"));

app.post('/api/initiate', async (req, res) => {
    console.log("\n=================================");
    console.log("📨 NOUVELLE DEMANDE DE PAIEMENT");
    
    // Force 200 FCFA pour que ça passe en prod
    const amount = req.body.amount < 200 ? 200 : req.body.amount;
    
    // ASTUCE : On remplace 127.0.0.1 par localhost pour éviter l'erreur "Invalid return_url"
    let returnUrl = req.body.returnUrl;
    if (returnUrl.includes('127.0.0.1')) {
        returnUrl = returnUrl.replace('127.0.0.1', 'localhost');
    }

    console.log(`👤 Client : ${req.body.customerName}`);
    console.log(`💰 Montant : ${amount} FCFA`);
    console.log(`↩️ URL Retour : ${returnUrl}`);

    try {
        const response = await axios.post(`${SENEPAY_CONFIG.baseUrl}/payments/initiate`, {
            amount: amount,
            currency: "XOF",
            orderId: "TICKET-" + Date.now(),
            customerName: req.body.customerName,
            customerPhone: req.body.customerPhone,
            returnUrl: returnUrl // URL corrigée envoyée à SenePay
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': SENEPAY_CONFIG.apiKey,
                'X-Api-Secret': SENEPAY_CONFIG.apiSecret
            }
        });

        // Gestion robuste de la réponse (parfois dans data.data, parfois data)
        const responseBody = response.data;
        const actualData = responseBody.data || responseBody;

        if (actualData && actualData.redirectUrl) {
            console.log("✅ SUCCÈS ! Redirection vers :", actualData.redirectUrl);
            res.json({ success: true, data: actualData });
        } else {
            console.log("⚠️ Réponse reçue mais lien manquant.");
            res.status(500).json({ success: false, message: "Lien introuvable" });
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
        const response = await axios.get(`${SENEPAY_CONFIG.baseUrl}/${req.params.token}/status`, {
            headers: {
                'X-Api-Key': SENEPAY_CONFIG.apiKey,
                'X-Api-Secret': SENEPAY_CONFIG.apiSecret
            }
        });
        res.json({ success: true, data: response.data.data || response.data });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n✅ SERVEUR PRÊT SUR http://localhost:${PORT}`);
});