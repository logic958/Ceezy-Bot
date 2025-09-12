// ------------------- MODULES ------------------- //
const express = require('express');
const bodyParser = require('body-parser');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const fs = require('fs');
const path = require('path');

// ------------------- CONFIG ------------------- //
const OWNER_JID = process.env.OWNER_JID || '263788915647@s.whatsapp.net'; // Owner number in WhatsApp jid format
let sock; // WhatsApp socket

// ------------------- EXPRESS WEBSITE ------------------- //
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Homepage
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>CeezyBotPairSite</title></head>
        <body style="font-family: Arial; text-align: center; padding: 20px;">
            <h1>🔑 CeezyBot Pairing Site</h1>
            <form method="POST" action="/pair">
                <label>Enter Phone Number (e.g. 263781826715):</label><br><br>
                <input type="text" name="number" placeholder="263xxxxxxxxx" required style="padding: 8px; width: 250px;">
                <br><br>
                <button type="submit" style="padding: 10px 20px;">Get Pairing Code</button>
            </form>
        </body>
        </html>
    `);
});

// Generate pairing code from website
app.post('/pair', async (req, res) => {
    const number = req.body.number?.replace(/\D/g, '');
    if (!number) return res.send('⚠️ Invalid phone number');

    try {
        const tempSock = makeWASocket({ printQRInTerminal: false, logger: pino({ level: 'silent' }) });
        const code = await tempSock.requestPairingCode(number);
        tempSock.ws.close();

        console.log(`Website generated code for ${number}: ${code}`);
        res.send(`<h2>🔑 Pairing code for ${number}: <b>${code}</b></h2>`);

        if (sock) {
            await sock.sendMessage(OWNER_JID, {
                text: `🌐 Website generated a pairing code!\n\n📱 Number: *${number}*\n🔑 Code: *${code}*`
            });
        }
    } catch (err) {
        res.send(`⚠️ Failed to generate code: ${err.message}`);
    }
});

// Railway will set the port automatically
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 CeezyBotPairSite running on port ${PORT}`));

// ------------------- WHATSAPP BOT ------------------- //
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session');

    sock = makeWASocket({
        auth: state,
        browser: ['Mac OS', 'Chrome', '140.0.7339.101'],
        printQRInTerminal: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        logger: pino({ level: 'silent' })
    });

    // Heartbeat
    setInterval(async () => { try { await sock.sendPresenceUpdate('available'); } catch {} }, 60_000);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : 0) !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || m.messages.length === 0) return;
        const msg = m.messages[0];
        const jid = msg.key.remoteJid;
        if (msg.key.fromMe) return;

        let text = '';
        if (msg.message?.conversation) text = msg.message.conversation;
        else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
        else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
        else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;

        text = text.trim().toLowerCase();

        // ---------------- COMMANDS ---------------- //
        // .owner
        if (text === '.owner') {
            const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ceezy Bot\nORG:Ashoka Uni;\nTEL;type=CELL;type=VOICE;waid=263788915647:+263788915647\nEND:VCARD';
            await sock.sendMessage(jid, { contacts: { displayName: 'Ceezy Bot', contacts: [{ vcard }] } });
            await sock.sendMessage(jid, { text: '📞 Contact the bot owner: *Ceezy Bot*' });
        }

        // .menu
        else if (text === '.menu') {
            const menuText = `🌟 _CEEZY X BOT_ 🌟 

👑 Owner: Crayne Sakala
👨‍💻 Programmer: Swaen

📚 Available Menu
1️⃣ .owner 👤 Get owner contact
2️⃣ .menu Ⓜ️ Show this menu
3️⃣ .programmer 👨‍💻 Programmer details
4️⃣ .pair <number> 🔑 Get pairing code
5️⃣ .song <song name> 🎵 Get song
6️⃣ .ping 🏓 Ping the bot

✨ Powered by CEEZY BOT`;
            await sock.sendMessage(jid, { text: menuText });
        }

        // .programmer
        else if (text === '.programmer') {
            const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Swaen\nORG:Ceezy Bot Project;\nTEL;type=CELL;type=VOICE;waid=263781826715:+263781826715\nEND:VCARD';
            await sock.sendMessage(jid, { contacts: { displayName: 'Swaen', contacts: [{ vcard }] } });
            await sock.sendMessage(jid, { text: '👨‍💻 Contact the bot developer: *Swaen*' });
        }

        // .pair
        else if (text.startsWith('.pair ')) {
            const number = text.split(' ')[1]?.replace(/\D/g, '');
            if (!number) return sock.sendMessage(jid, { text: '⚠️ Usage: `.pair <phonenumber>`' });

            try {
                const tempSock = makeWASocket({ printQRInTerminal: false, logger: pino({ level: 'silent' }) });
                const code = await tempSock.requestPairingCode(number);
                tempSock.ws.close();

                await sock.sendMessage(jid, { text: `🔑 Pairing code for *${number}*:\n\n*${code}*` });

                // Notify owner
                await sock.sendMessage(OWNER_JID, {
                    text: `📢 Someone requested a pairing code!\n\n👤 User: *${jid}*\n📱 Number: *${number}*\n🔑 Code: *${code}*`
                });

                console.log(`Generated pairing code for ${number}: ${code}`);
            } catch (err) {
                await sock.sendMessage(jid, { text: `⚠️ Failed to generate code: ${err.message}` });
            }
        }

        // .song
        else if (text.startsWith('.song ')) {
            const songQuery = text.slice(6).trim();
            if (!songQuery) return sock.sendMessage(jid, { text: '⚠️ Usage: `.song <song name>`' });

            try {
                const searchResult = await ytSearch(songQuery);
                if (!searchResult || !searchResult.videos.length)
                    return sock.sendMessage(jid, { text: `⚠️ No results for: *${songQuery}*` });

                const video = searchResult.videos[0];
                const videoUrl = video.url;
                const outputPath = path.join(__dirname, `${video.videoId}.mp3`);
                const audioStream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
                const writeStream = fs.createWriteStream(outputPath);
                audioStream.pipe(writeStream);

                writeStream.on('finish', async () => {
                    await sock.sendMessage(jid, {
                        audio: fs.readFileSync(outputPath),
                        mimetype: 'audio/mpeg',
                        fileName: `${video.title}.mp3`
                    });
                    fs.unlinkSync(outputPath);
                });

                writeStream.on('error', (err) => {
                    console.error('Audio write error:', err);
                    sock.sendMessage(jid, { text: `⚠️ Failed to process the song: ${err.message}` });
                });

                await sock.sendMessage(jid, { text: `🎵 Downloading and sending: *${video.title}*` });
            } catch (err) {
                console.error('Failed to download song:', err);
                await sock.sendMessage(jid, { text: `⚠️ Failed to get song: ${err.message}` });
            }
        }

        // .ping
        else if (text === '.ping') {
            await sock.sendMessage(jid, { text: '🏓 Pong!' });
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();