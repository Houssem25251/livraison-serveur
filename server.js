const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const NEON_URL = "postgresql://neondb_owner:npg_SXtMB9sOozA1@ep-hidden-feather-anup50s5-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require";
const db = new Client({ connectionString: NEON_URL });
db.connect().then(() => console.log('✅ Connected to Neon DB'));

// 1. LOGIN ROUTE
app.post('/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const result = await db.query(
            'SELECT idpers, nompers, codeposte AS role FROM Personnel WHERE Login = $1 AND motP = $2', 
            [login, password]
        );
        if (result.rows.length > 0) res.json({ success: true, user: result.rows[0] });
        else res.status(401).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. FETCH ALL DELIVERIES (For Boss Dashboard & Controller)
// FIXED: Now selects ALL columns so the "Card" shows details
app.get('/all-deliveries', async (req, res) => {
    try {
        const result = await db.query('SELECT nocde, dateliv, livreur_id, modepay, etatliv, remarque, nomclt, villeclt, telclt FROM LivraisonCom');
        res.json(result.rows);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 3. UPDATE DELIVERY STATUS
app.post('/update-delivery', async (req, res) => {
    const { nocde, status, remarque } = req.body;
    try {
        await db.query('UPDATE LivraisonCom SET etatliv = $1, remarque = $2 WHERE nocde = $3', [status, remarque, nocde]);
        // Notify all apps (Dashboard & Controller) to refresh
        io.emit('status_changed', { nocde, status });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. FETCH DELIVERIES FOR SPECIFIC DRIVER
app.get('/my-deliveries/:driverId', async (req, res) => {
    const driverId = parseInt(req.params.driverId);
    try {
        const query = `
            SELECT nocde, dateliv, etatliv, modepay, remarque, nomclt, telclt, villeclt 
            FROM LivraisonCom 
            WHERE livreur_id = $1;
        `;
        const result = await db.query(query, [driverId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. EMERGENCY ALERT
app.post('/emergency', (req, res) => {
    const { nocde } = req.body;
    io.emit('emergency_alert', "🚨 URGENCE: Problème sur la commande " + nocde);
    res.json({ success: true });
});

// WEBSOCKETS (Broadcast & Connection)
// GESTION DES WEBSOCKETS
io.on('connection', (socket) => {
    console.log('🔌 Un utilisateur est connecté :', socket.id);

    // 1. Le livreur s'enregistre (ex: ID "5")
    socket.on('join_room', (userId) => {
        const roomName = "user_" + userId;
        socket.join(roomName);
        console.log(`🏠 LIVREUR ENREGISTRÉ : ID ${userId} est dans la room ${roomName}`);
    });

    // 2. Message GLOBAL (Contrôleur -> Tout le monde)
    socket.on('send_broadcast', (msg) => {
        console.log('📢 DIFFUSION GLOBALE :', msg);
        io.emit('receive_broadcast', msg);
    });

    // 3. Message PRIVÉ (Contrôleur -> Un livreur précis)
    socket.on('send_private', (data) => {
        // data doit être { targetId: "5", message: "Texte" }
        const roomName = "user_" + data.targetId;
        console.log(`📩 PRIVÉ pour ${roomName} :`, data.message);
        
        // On envoie UNIQUEMENT à cette room
        io.to(roomName).emit('receive_private', data.message);
    });

    socket.on('disconnect', () => {
        console.log('❌ Déconnexion');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on Port ${PORT}`));
