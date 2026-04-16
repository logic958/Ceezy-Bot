// ------------------- MODULES ------------------- //
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Add this to dependencies for unique filenames

// ------------------- CONFIG ------------------- //
const OWNER_JID = process.env.OWNER_JID || '263788915647@s.whatsapp.net';
const PORT = process.env.PORT || 3000;
const SESSION_DIR = process.env.SESSION_DIR || './session';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Logger
const logger = pino({
    level: LOG_LEVEL,
    transport: LOG_LEVEL !== 'silent' ? { target: 'pino-pretty', options: { colorize: true } } : undefined
});

let sock; // WhatsApp socket

// ------------------- EXPRESS WEBSITE ------------------- //
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Rate limiting for pairing endpoint (prevent abuse)
const pairLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window per IP
    message: 'Too many pairing requests from this IP, please try again later.'
});

// Homepage
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>CeezyBot Pairing</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 30px; background: #f5f5f5; }
                h1 { color: #075e54; }
                form { background: white; padding: 30px; border-radius: 10px; display: inline-block; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                input { padding: 12px; width: 250px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; }
                button { background: #25d366; color: white; border: none; padding: 12px 25px; border-radius: 5px; font-size: 16px; cursor: pointer; }
                button:hover { background: #128c7e; }
            </style>
        </head>
        <body>
            <h1>🔑 CeezyBot Pairing</h1>
            <form method="POST" action="/pair">
                <label>Enter phone number (with country code):</label><br><br>
                <input type="text" name="number" placeholder="e.g. 263781826715" required>
                <br><br>
                <button type="submit">Get Pairing Code</button>
            </form>
            <p style="margin-top: 20px; color: #666;">This code works only for linking a new device to WhatsApp.</p>
        </body>
        </html>
    `);
});

// Generate pairing code from website
app.post('/pair', pairLimiter, async (req, res) => {
    const number = req.body.number?.replace(/\D/g, '');
    if (!number) return res.status(400).send('⚠️ Invalid phone number');

    let tempSock;
    try {
        tempSock = makeWASocket({
            printQRInTerminal: false,
            logger: pino({ level: 'silent' })
        });

        const code = await tempSock.requestPairingCode(number);
        
        // Properly close the temporary socket
        await tempSock.logout();
        tempSock.ws.close();

        logger.info(`Website generated pairing code for ${number}: ${code}`);
        
        // Notify owner
        if (sock) {
            await sock.sendMessage(OWNER_JID, {
                text: `🌐 *Website Pairing Request*\n\n📱 Number: *${number}*\n🔑 Code: *${code}*`
            });
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Pairing Code</title></head>
            <body style="font-family: Arial; text-align: center; padding: 30px;">
                <h2>✅ Pairing Code Generated</h2>
                <div style="background: #eee; padding: 20px; font-size: 32px; letter-spacing: 4px; border-radius: 10px; margin: 20px;">
                    <strong>${code}</strong>
                </div>
                <p>Number: <strong>${number}</strong></p>
                <p>Enter this code in your WhatsApp linked devices screen.</p>
                <a href="/">← Generate another</a>
            </body>
            </html>
        `);
    } catch (err) {
        logger.error(`Pairing error for ${number}: ${err.message}`);
        res.status(500).send(`⚠️ Failed to generate code: ${err.message}`);
    } finally {
        if (tempSock && !tempSock.ws.closed) {
            tempSock.ws.close();
        }
    }
});

// Start web server
app.listen(PORT, () => logger.info(`🌐 Web server running on port ${PORT}`));

// ------------------- WHATSAPP BOT ------------------- //
const commandHandlers = new Map();

// Helper: send a vCard contact
async function sendContact(jid, displayName, phoneNumber) {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${displayName}\nORG:Ceezy Bot;\nTEL;type=CELL;type=VOICE;waid=${phoneNumber}:+${phoneNumber}\nEND:VCARD`;
    await sock.sendMessage(jid, { contacts: { displayName, contacts: [{ vcard }] } });
    await sock.sendMessage(jid, { text: `📞 Contact: *${displayName}*` });
}

// Command: .owner
commandHandlers.set('.owner', async (msg, jid) => {
    await sendContact(jid, 'Ceezy Bot', '263788915647');
});

// Command: .programmer
commandHandlers.set('.programmer', async (msg, jid) => {
    await sendContact(jid, 'Swaen', '263781826715');
});

// Command: .menu
commandHandlers.set('.menu', async (msg, jid) => {
    const menuText = `🌟 *CEEZY X BOT* 🌟 

👑 Owner: Crayne Sakala
👨‍💻 Programmer: Swaen

📚 *Available Commands*
1️⃣ *.owner* - Get owner contact
2️⃣ *.menu* - Show this menu
3️⃣ *.programmer* - Programmer details
4️⃣ *.pair <number>* - Get pairing code
5️⃣ *.song <name>* - Download a song
6️⃣ *.ping* - Check bot response

✨ Powered by CEEZY BOT`;
    await sock.sendMessage(jid, { text: menuText });
});

// Command: .ping
commandHandlers.set('.ping', async (msg, jid) => {
    await sock.sendMessage(jid, { text: '🏓 Pong!' });
});

// Command: .pair
commandHandlers.set('.pair', async (msg, jid, args) => {
    const number = args[0]?.replace(/\D/g, '');
    if (!number) {
        return sock.sendMessage(jid, { text: '⚠️ Usage: `.pair <phonenumber>`' });
    }

    let tempSock;
    try {
        tempSock = makeWASocket({
            printQRInTerminal: false,
            logger: pino({ level: 'silent' })
        });

        const code = await tempSock.requestPairingCode(number);
        await tempSock.logout();
        tempSock.ws.close();

        await sock.sendMessage(jid, { text: `🔑 Pairing code for *${number}*:\n\n*${code}*` });

        // Notify owner
        await sock.sendMessage(OWNER_JID, {
            text: `📢 *Pairing Request from Bot*\n\n👤 User: *${jid.split('@')[0]}*\n📱 Number: *${number}*\n🔑 Code: *${code}*`
        });

        logger.info(`Bot generated pairing code for ${number} (requested by ${jid})`);
    } catch (err) {
        await sock.sendMessage(jid, { text: `⚠️ Failed to generate code: ${err.message}` });
    } finally {
        if (tempSock && !tempSock.ws.closed) {
            tempSock.ws.close();
        }
    }
});

// Command: .song (fixed streaming & unique filenames)
commandHandlers.set('.song', async (msg, jid, args) => {
    const songQuery = args.join(' ').trim();
    if (!songQuery) {
        return sock.sendMessage(jid, { text: '⚠️ Usage: `.song <song name>`' });
    }

    let video, videoUrl, outputPath;
    try {
        // Search for the song
        const searchResult = await ytSearch(songQuery);
        if (!searchResult || !searchResult.videos.length) {
            return sock.sendMessage(jid, { text: `⚠️ No results for: *${songQuery}*` });
        }

        video = searchResult.videos[0];
        videoUrl = video.url;
        
        // Generate unique filename to avoid collisions
        const uniqueId = uuidv4();
        outputPath = path.join(__dirname, `${uniqueId}.mp3`);

        // Notify user that download has started
        await sock.sendMessage(jid, { text: `🎵 Downloading: *${video.title}*` });

        // Download and convert to MP3 using stream
        const audioStream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
        const writeStream = fs.createWriteStream(outputPath);

        // Pipe the audio stream to file
        await new Promise((resolve, reject) => {
            audioStream.pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            audioStream.on('error', reject);
        });

        // Send the audio using a readable stream (Baileys supports stream directly)
        await sock.sendMessage(jid, {
            audio: { stream: fs.createReadStream(outputPath) },
            mimetype: 'audio/mpeg',
            fileName: `${video.title}.mp3`,
            ptt: false
        });

        logger.info(`Sent song: ${video.title} to ${jid}`);
    } catch (err) {
        logger.error(`Song download error: ${err.message}`);
        await sock.sendMessage(jid, { text: `⚠️ Failed to download song: ${err.message}` });
    } finally {
        // Clean up temporary file
        if (outputPath && fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }
    }
});

// ------------------- MESSAGE PROCESSING ------------------- //
async function processMessage(msg) {
    const jid = msg.key.remoteJid;
    if (!jid || msg.key.fromMe) return;

    let text = '';
    if (msg.message?.conversation) text = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
    else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;

    if (!text) return;

    const normalizedText = text.trim().toLowerCase();
    const parts = normalizedText.split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    const handler = commandHandlers.get(command);
    if (handler) {
        try {
            await handler(msg, jid, args);
        } catch (err) {
            logger.error(`Command error (${command}): ${err.message}`);
            await sock.sendMessage(jid, { text: `❌ Error executing command: ${err.message}` });
        }
    }
}

// ------------------- CONNECTION MANAGEMENT ------------------- //
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        browser: ['Mac OS', 'Chrome', '140.0.7339.101'],
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        logger: logger
    });

    // Heartbeat to stay online
    setInterval(async () => {
        try { await sock.sendPresenceUpdate('available'); } catch {}
    }, 60_000);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : 0) !== DisconnectReason.loggedOut;
            logger.warn(`Connection closed. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            logger.info('✅ WhatsApp connection opened!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
            for (const msg of m.messages) {
                await processMessage(msg);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Start everything
connectToWhatsApp().catch(err => logger.error(`Fatal error: ${err.message}`));