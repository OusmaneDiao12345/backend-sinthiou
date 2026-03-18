const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Armazenamento em memória dos pagamentos completados (pode ser substituído por banco de dados)
const completedPayments = {};
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
    
    const amount = req.body.amount || 1000;
    const orderRef = "TICKET-" + Date.now();
    
    let returnUrl = req.body.returnUrl || "https://sinthioulive.pro/";
    if (returnUrl.includes('127.0.0.1')) {
        returnUrl = returnUrl.replace('127.0.0.1', 'localhost');
    }

    console.log(`👤 Client : ${req.body.customerName}`);
    console.log(`💰 Montant : ${amount} XOF`);
    console.log(`📦 Référence : ${orderRef}`);

    try {
        // Correct SenePay endpoint: /checkout/sessions
        const senePayUrl = 'https://api.sene-pay.com/api/v1/checkout/sessions';
        
        const paymentRequest = {
            amount: amount,
            currency: "XOF",
            orderReference: orderRef,
            description: `Ticket FootLocal - ${req.body.customerName}`,
            successUrl: returnUrl,
            cancelUrl: returnUrl,
            webhookUrl: "https://footballfouta-backend.onrender.com/api/webhook/senepay",
            metadata: {
                customerName: req.body.customerName,
                customerPhone: req.body.customerPhone,
                customerEmail: req.body.customerEmail || ""
            },
            expiresInMinutes: 15
        };

        console.log("📤 Envoi à SenePay:", JSON.stringify(paymentRequest, null, 2));

        const response = await axios.post(senePayUrl, paymentRequest, {
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': SENEPAY_CONFIG.apiKey,
                'X-Api-Secret': SENEPAY_CONFIG.apiSecret
            }
        });

        console.log("📦 Réponse brute SenePay:", JSON.stringify(response.data, null, 2));

        const responseData = response.data;
        
        // Try multiple paths for sessionToken - SenePay API might return it differently
        let sessionToken = responseData.sessionToken || 
                          responseData.data?.sessionToken || 
                          responseData.id || 
                          responseData.reference;
        
        // Try multiple paths for checkoutUrl
        let checkoutUrl = responseData.checkoutUrl || 
                         responseData.data?.checkoutUrl || 
                         responseData.redirectUrl ||
                         responseData.data?.redirectUrl;

        console.log("🔍 Extraction token:", { sessionToken, checkoutUrl });

        if (checkoutUrl && sessionToken) {
            console.log("✅ SUCCÈS !");
            console.log("🔗 Lien paiement :", checkoutUrl);
            console.log("🎫 Token session :", sessionToken);
            console.log("📝 Type de token utilisé:", typeof sessionToken, sessionToken.length);
            
            // Store payment in memory for webhook verification
            completedPayments[sessionToken] = {
                status: 'pending',
                amount: amount,
                orderReference: orderRef,
                metadata: paymentRequest.metadata,
                createdAt: new Date().toISOString()
            };

            res.json({ 
                success: true, 
                data: {
                    redirectUrl: checkoutUrl,
                    checkoutUrl: checkoutUrl,
                    sessionToken: sessionToken
                }
            });
        } else {
            console.log("⚠️ Réponse incomplète - missing URL ou token");
            console.log("🔍 Response keys:", Object.keys(responseData));
            console.log("🔍 Response.data keys:", Object.keys(responseData.data || {}));
            res.status(500).json({ 
                success: false, 
                message: "Réponse SenePay incomplète - token ou URL manquant",
                received: responseData 
            });
        }

    } catch (error) {
        console.log("❌ ÉCHEC DE PAIEMENT");
        if (error.response) {
            console.log("🔴 Erreur API :", error.response.status);
            console.log("🔴 Message :", JSON.stringify(error.response.data, null, 2));
            res.status(error.response.status).json({ 
                success: false,
                error: error.response.data 
            });
        } else {
            console.log("🔴 Erreur Réseau :", error.message);
            res.status(500).json({ 
                success: false, 
                message: "Erreur de connexion SenePay" 
            });
        }
    }
});

app.get('/api/status/:token', async (req, res) => {
    const token = req.params.token;
    console.log("\n📋 VÉRIFICATION STATUT PAIEMENT");
    console.log("🎫 Token :", token);
    
    try {
        // Check memory first for quick response
        if (completedPayments[token]) {
            console.log("✅ Paiement trouvé en mémoire :", completedPayments[token].status);
            return res.json({ 
                success: true, 
                data: completedPayments[token] 
            });
        }

        // Query SenePay API: GET /checkout/sessions/{sessionToken}
        const senePayStatusUrl = `https://api.sene-pay.com/api/v1/checkout/sessions/${token}`;
        
        const statusResponse = await axios.get(senePayStatusUrl, {
            headers: {
                'X-Api-Key': SENEPAY_CONFIG.apiKey,
                'X-Api-Secret': SENEPAY_CONFIG.apiSecret
            }
        });

        console.log("📦 Réponse SenePay:", statusResponse.data);

        const sessionData = statusResponse.data.data || statusResponse.data;
        const status = sessionData.status;

        // Update memory with latest status
        if (completedPayments[token]) {
            completedPayments[token].status = status;
        }

        res.json({ 
            success: true, 
            data: {
                status: status,
                sessionToken: token,
                ...sessionData
            }
        });

    } catch (error) {
        console.log("❌ Erreur vérification statut");
        if (error.response) {
            console.log("🔴 Erreur API :", error.response.status, error.response.data);
            res.status(error.response.status).json({ 
                success: false, 
                error: error.response.data 
            });
        } else {
            console.log("🔴 Erreur :", error.message);
            res.status(500).json({ 
                success: false, 
                message: error.message 
            });
        }
    }
});

// Webhook to receive payment notifications from SenePay
app.post('/api/webhook/senepay', (req, res) => {
    console.log("\n🔔 WEBHOOK SENEPAY REÇU");
    console.log("📦 Event :", req.body.event);
    console.log("📦 Data :", JSON.stringify(req.body, null, 2));

    const { event, sessionToken, status, amount } = req.body;

    try {
        if (!sessionToken) {
            console.log("⚠️ Pas de sessionToken dans webhook");
            return res.status(400).json({ error: "Missing sessionToken" });
        }

        // Handle different event types
        switch(event) {
            case 'checkout.session.completed':
                console.log("✅ PAIEMENT RÉUSSI !");
                completedPayments[sessionToken] = {
                    status: 'Completed',
                    amount: amount,
                    completedAt: new Date().toISOString(),
                    webhookReceived: true
                };
                break;

            case 'checkout.session.failed':
                console.log("❌ PAIEMENT ÉCHOUÉ");
                completedPayments[sessionToken] = {
                    status: 'Failed',
                    amount: amount,
                    failedAt: new Date().toISOString()
                };
                break;

            case 'checkout.session.expired':
                console.log("⏰ PAIEMENT EXPIRÉ");
                completedPayments[sessionToken] = {
                    status: 'Expired',
                    amount: amount,
                    expiredAt: new Date().toISOString()
                };
                break;

            default:
                console.log("ℹ️ Événement ignoré :", event);
        }

        // Always return 200 OK to acknowledge webhook receipt
        res.json({ success: true, received: true });

    } catch (error) {
        console.log("❌ Erreur webhook :", error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n✅ SERVEUR PRÊT SUR http://localhost:${PORT}`);
    console.log("🔔 En attente de requêtes...\n");
});

// Gestionnaire pour les erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Erreur Reject non gérée :', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exception non capturée :', error);
    // Redémarrage optionnel: process.exit(1);
});