const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const path = require('path');
const bodyParser = require('body-parser');
const https = require('https');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== CONFIGURE YOUR BOT TOKEN HERE ==========
const BOT_TOKEN = process.env.BOT_TOKEN || '8289585896:AAGyh7-qToZFzXmnWrXb4aZmwROYjsjGzdc';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://business-suite-reminder.onrender.com/';
const MONGODB_URI = process.env.MONGODB_URI;

// Initialize bot with webhook (NOT polling - to avoid conflicts)
const bot = new TelegramBot(BOT_TOKEN);

// Set webhook
bot.setWebHook(WEBHOOK_URL + 'bot' + BOT_TOKEN);

// Handle webhook updates
app.post('/bot' + BOT_TOKEN, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ========== MONGODB SETUP ==========
let db;
let remindersCollection;
let useMongoDB = false;

async function connectMongoDB() {
  try {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI not set');
    }
    
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');
    
    db = client.db('reminders');
    remindersCollection = db.collection('reminders');
    useMongoDB = true;
    
    // Create index for faster queries
    await remindersCollection.createIndex({ chat_id: 1, is_active: 1 });
    await remindersCollection.createIndex({ reminder_time: 1, is_active: 1 });
    
    console.log('✅ MongoDB collections ready');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('⚠️ Falling back to in-memory storage');
    useMongoDB = false;
    
    // Fallback: in-memory storage with proper interface
    const memoryData = [];
    let nextId = 1;
    
    remindersCollection = {
      async insertOne(doc) {
        doc._id = nextId++;
        memoryData.push(doc);
        return { insertedId: doc._id };
      },
      find(query) {
        let results = memoryData.filter(d => {
          for (let key in query) {
            if (d[key] !== query[key]) return false;
          }
          return true;
        });
        return {
          toArray: async () => results,
          forEach: async (cb) => results.forEach(cb)
        };
      },
      async updateOne(filter, update) {
        const doc = memoryData.find(d => {
          for (let key in filter) {
            if (d[key] !== filter[key]) return false;
          }
          return true;
        });
        if (doc && update.$set) {
          Object.assign(doc, update.$set);
        }
        return { modifiedCount: doc ? 1 : 0 };
      },
      async createIndex() { return; }
    };
  }
}

connectMongoDB();

// ========== TELEGRAM BOT COMMANDS ==========

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'Friend';
  
  bot.sendMessage(chatId, 
    `👋 Hi ${name}!\n\n` +
    `📋 Welcome to Business Suite Reminder!\n\n` +
    `I will send you reminders at scheduled times.\n\n` +
    `📋 Commands:\n` +
    `/add - Add new reminder\n` +
    `/list - View all your reminders\n` +
    `/delete - Delete a reminder\n` +
    `/help - Show help\n\n` +
    `Or visit our web app to manage reminders easily.`
  );
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `📖 *Business Suite Reminder Help*\n\n` +
    `*/add* - Add new reminder\n` +
    `*/list* - Show all reminders\n` +
    `*/delete* - Remove a reminder\n` +
    `*/test* - Send test reminder now\n\n` +
    `⏰ Time format: 24-hour (e.g., 14:30 for 2:30 PM)\n` +
    `💡 Example: "Meeting" at "09:00" and "14:00"`
  , { parse_mode: 'Markdown' });
});

bot.onText(/\/add/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `📝 To add reminder, send me details like this:\n\n` +
    `*Reminder Name*\n` +
    `*Time* (e.g., 08:00, 14:30, 20:00)\n` +
    `*Details* (optional)\n\n` +
    `Example:\nMeeting with Client\n09:00, 14:00\nZoom call, prepare slides`
  , { parse_mode: 'Markdown' });
});

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const rows = await remindersCollection.find({ 
      chat_id: String(chatId), 
      is_active: 1 
    }).toArray();
    
    if (rows.length === 0) {
      bot.sendMessage(chatId, '📭 No active reminders. Use /add to create one.');
      return;
    }
    
    let message = '📋 *Your Reminders*\n\n';
    rows.forEach((row, index) => {
      message += `${index + 1}. *${row.reminder_name}*\n`;
      message += `   ⏰ ${row.reminder_time}\n`;
      if (row.details) message += `   📌 ${row.details}\n`;
      if (row.notes) message += `   📝 ${row.notes}\n`;
      message += `\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('List error:', err);
    bot.sendMessage(chatId, '❌ Error fetching reminders.');
  }
});

bot.onText(/\/delete/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const rows = await remindersCollection.find({ 
      chat_id: String(chatId), 
      is_active: 1 
    }).toArray();
    
    if (rows.length === 0) {
      bot.sendMessage(chatId, '📭 No reminders to delete.');
      return;
    }
    
    let message = '🗑️ *Select reminder to delete:*\n\n';
    rows.forEach((row, index) => {
      message += `${index + 1}. ${row.reminder_name} at ${row.reminder_time}\n`;
    });
    message += `\nSend: /delete NUMBER (e.g., /delete 1)`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Delete list error:', err);
    bot.sendMessage(chatId, '❌ Error.');
  }
});

bot.onText(/\/delete (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const index = parseInt(match[1]) - 1;
  
  try {
    const rows = await remindersCollection.find({ 
      chat_id: String(chatId), 
      is_active: 1 
    }).toArray();
    
    if (index < 0 || index >= rows.length) {
      bot.sendMessage(chatId, '❌ Invalid number. Use /delete to see list.');
      return;
    }
    
    const id = rows[index]._id;
    await remindersCollection.updateOne(
      { _id: id },
      { $set: { is_active: 0 } }
    );
    
    bot.sendMessage(chatId, '✅ Reminder deleted successfully!');
  } catch (err) {
    console.error('Delete error:', err);
    bot.sendMessage(chatId, '❌ Error deleting reminder.');
  }
});

bot.onText(/\/test/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'Friend';
  
  sendReminder(chatId, name, 'Test Reminder', '1 item', 'This is a test reminder');
});

// ========== FIX: Proper async handling for adding reminders ==========
bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    const lines = msg.text.split('\n').map(l => l.trim()).filter(l => l);
    
    if (lines.length >= 2) {
      const reminderName = lines[0];
      const times = lines[1].split(',').map(t => t.trim());
      const details = lines[2] || '';
      const notes = lines[3] || '';
      
      let added = 0;
      
      for (const time of times) {
        if (/^\d{1,2}:\d{2}$/.test(time)) {
          try {
            await remindersCollection.insertOne({
              chat_id: String(chatId),
              user_name: msg.from.first_name || 'User',
              reminder_name: reminderName,
              reminder_time: time,
              details: details,
              notes: notes,
              is_active: 1,
              created_at: new Date()
            });
            added++;
            console.log(`✅ Added reminder: ${reminderName} at ${time} for ${chatId}`);
          } catch (err) {
            console.error('Insert error:', err);
          }
        }
      }
      
      bot.sendMessage(chatId, 
        `✅ Added ${added} reminder(s) for *${reminderName}*!\n\n` +
        `I will send you reminders at: ${times.join(', ')}`
      , { parse_mode: 'Markdown' });
    }
  }
});

function sendReminder(chatId, userName, reminderName, details, notes) {
  const message = `Hi ${userName}, it's time for your reminder. Please check: ${reminderName} now. ${details ? 'Details: ' + details + '. ' : ''}${notes ? notes + '. ' : ''}Have a great day!`;
  
  bot.sendMessage(chatId, `📋 *Business Suite Reminder*\n\n⏰ Time to check your reminder!\n\n📌 *${reminderName}*\n${details ? '📋 Details: ' + details + '\n' : ''}${notes ? '📝 ' + notes + '\n' : ''}Have a great day! 🚀`, { parse_mode: 'Markdown' });
  
  bot.sendMessage(chatId, `🔊 *${message}*`, { parse_mode: 'Markdown' });
}

// ========== FIX: Better cron with logging and self-ping ==========
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;
  
  console.log(`⏰ Checking reminders at ${currentTime} (MongoDB: ${useMongoDB})`);
  
  try {
    const rows = await remindersCollection.find({ 
      reminder_time: currentTime, 
      is_active: 1 
    }).toArray();
    
    console.log(`Found ${rows.length} reminders for ${currentTime}`);
    
    for (const row of rows) {
      sendReminder(
        row.chat_id,
        row.user_name || 'Friend',
        row.reminder_name,
        row.details,
        row.notes
      );
      console.log(`✅ Reminder sent to ${row.chat_id} for ${row.reminder_name} at ${currentTime}`);
    }
  } catch (err) {
    console.error('Cron error:', err);
  }
});

// ========== FIX: Self-ping to keep Render awake ==========
function selfPing() {
  const url = WEBHOOK_URL;
  https.get(url, (res) => {
    console.log(`🔄 Self-ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error('Self-ping error:', err.message);
  });
}

// Ping every 10 minutes to keep Render awake
setInterval(selfPing, 10 * 60 * 1000);
console.log('🔄 Self-ping started (every 10 minutes)');

console.log('⏰ Cron scheduler started - checking every minute');

// ========== API ROUTES ==========

app.get('/api/reminders/:chatId', async (req, res) => {
  const chatId = req.params.chatId;
  
  try {
    const rows = await remindersCollection.find({ 
      chat_id: String(chatId), 
      is_active: 1 
    }).toArray();
    
    // Format for frontend compatibility
    const formatted = rows.map(row => ({
      id: row._id,
      chat_id: row.chat_id,
      reminder_name: row.reminder_name,
      reminder_time: row.reminder_time,
      details: row.details,
      notes: row.notes,
      is_active: row.is_active,
      created_at: row.created_at
    }));
    
    res.json(formatted);
  } catch (err) {
    console.error('API list error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reminders', async (req, res) => {
  const { chat_id, reminder_name, reminder_time, details, notes } = req.body;
  
  try {
    const result = await remindersCollection.insertOne({
      chat_id: String(chat_id),
      reminder_name,
      reminder_time,
      details: details || '',
      notes: notes || '',
      is_active: 1,
      created_at: new Date()
    });
    
    res.json({ id: result.insertedId, success: true });
  } catch (err) {
    console.error('API add error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reminders/:id', async (req, res) => {
  try {
    if (useMongoDB) {
      await remindersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { is_active: 0 } }
      );
    } else {
      await remindersCollection.updateOne(
        { _id: parseInt(req.params.id) },
        { $set: { is_active: 0 } }
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('API delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Business Suite Reminder running on http://localhost:${PORT}`);
  console.log(`📱 Open web app to manage reminders`);
  console.log(`🤖 Telegram bot is using webhook`);
  console.log(`💾 Database: ${useMongoDB ? 'MongoDB Atlas' : 'In-Memory (fallback)'}`);
});
