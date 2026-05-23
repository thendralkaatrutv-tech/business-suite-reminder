const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== CONFIGURE YOUR BOT TOKEN HERE ==========
const BOT_TOKEN = process.env.BOT_TOKEN || '8289585896:AAGyh7-qToZFzXmnWrXb4aZmwROYjsjGzdc';

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========== DATABASE SETUP ==========
const db = new sqlite3.Database('./reminders.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    user_name TEXT,
    reminder_name TEXT NOT NULL,
    reminder_time TEXT NOT NULL,
    details TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

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

bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  
  db.all(
    'SELECT * FROM reminders WHERE chat_id = ? AND is_active = 1 ORDER BY reminder_time',
    [chatId],
    (err, rows) => {
      if (err) {
        bot.sendMessage(chatId, '❌ Error fetching reminders.');
        return;
      }
      
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
    }
  );
});

bot.onText(/\/delete/, (msg) => {
  const chatId = msg.chat.id;
  
  db.all(
    'SELECT id, reminder_name, reminder_time FROM reminders WHERE chat_id = ? AND is_active = 1',
    [chatId],
    (err, rows) => {
      if (err || rows.length === 0) {
        bot.sendMessage(chatId, '📭 No reminders to delete.');
        return;
      }
      
      let message = '🗑️ *Select reminder to delete:*\n\n';
      rows.forEach((row, index) => {
        message += `${index + 1}. ${row.reminder_name} at ${row.reminder_time}\n`;
      });
      message += `\nSend: /delete NUMBER (e.g., /delete 1)`;
      
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
  );
});

bot.onText(/\/delete (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const index = parseInt(match[1]) - 1;
  
  db.all(
    'SELECT id FROM reminders WHERE chat_id = ? AND is_active = 1 ORDER BY reminder_time',
    [chatId],
    (err, rows) => {
      if (err || index < 0 || index >= rows.length) {
        bot.sendMessage(chatId, '❌ Invalid number. Use /delete to see list.');
        return;
      }
      
      const id = rows[index].id;
      db.run('UPDATE reminders SET is_active = 0 WHERE id = ?', [id], (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ Error deleting reminder.');
        } else {
          bot.sendMessage(chatId, '✅ Reminder deleted successfully!');
        }
      });
    }
  );
});

bot.onText(/\/test/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'Friend';
  
  sendReminder(chatId, name, 'Test Reminder', '1 item', 'This is a test reminder');
});

bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    const lines = msg.text.split('\n').map(l => l.trim()).filter(l => l);
    
    if (lines.length >= 2) {
      const reminderName = lines[0];
      const times = lines[1].split(',').map(t => t.trim());
      const details = lines[2] || '';
      const notes = lines[3] || '';
      
      let added = 0;
      times.forEach(time => {
        if (/^\d{1,2}:\d{2}$/.test(time)) {
          db.run(
            'INSERT INTO reminders (chat_id, user_name, reminder_name, reminder_time, details, notes) VALUES (?, ?, ?, ?, ?, ?)',
            [chatId, msg.from.first_name || 'User', reminderName, time, details, notes],
            (err) => {
              if (!err) added++;
            }
          );
        }
      });
      
      setTimeout(() => {
        bot.sendMessage(chatId, 
          `✅ Added ${added} reminder(s) for *${reminderName}*!\n\n` +
          `I will send you reminders at: ${times.join(', ')}`
        , { parse_mode: 'Markdown' });
      }, 500);
    }
  }
});

function sendReminder(chatId, userName, reminderName, details, notes) {
  const message = `Hi ${userName}, it's time for your reminder. Please check: ${reminderName} now. ${details ? 'Details: ' + details + '. ' : ''}${notes ? notes + '. ' : ''}Have a great day!`;
  
  bot.sendMessage(chatId, `📋 *Business Suite Reminder*\n\n⏰ Time to check your reminder!\n\n📌 *${reminderName}*\n${details ? '📋 Details: ' + details + '\n' : ''}${notes ? '📝 ' + notes + '\n' : ''}\nHave a great day! 🚀`, { parse_mode: 'Markdown' });
  
  bot.sendMessage(chatId, `🔊 *${message}*`, { parse_mode: 'Markdown' });
}

cron.schedule('* * * * *', () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;
  
  db.all(
    'SELECT * FROM reminders WHERE reminder_time = ? AND is_active = 1',
    [currentTime],
    (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return;
      }
      
      rows.forEach(row => {
        sendReminder(
          row.chat_id,
          row.user_name || 'Friend',
          row.reminder_name,
          row.details,
          row.notes
        );
        console.log(`Reminder sent to ${row.chat_id} for ${row.reminder_name} at ${currentTime}`);
      });
    }
  );
});

console.log('⏰ Cron scheduler started - checking every minute');

app.get('/api/reminders/:chatId', (req, res) => {
  const chatId = req.params.chatId;
  db.all(
    'SELECT * FROM reminders WHERE chat_id = ? AND is_active = 1 ORDER BY reminder_time',
    [chatId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

app.post('/api/reminders', (req, res) => {
  const { chat_id, reminder_name, reminder_time, details, notes } = req.body;
  
  db.run(
    'INSERT INTO reminders (chat_id, reminder_name, reminder_time, details, notes) VALUES (?, ?, ?, ?, ?)',
    [chat_id, reminder_name, reminder_time, details, notes],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID, success: true });
    }
  );
});

app.delete('/api/reminders/:id', (req, res) => {
  db.run('UPDATE reminders SET is_active = 0 WHERE id = ?', [req.params.id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Business Suite Reminder running on http://localhost:${PORT}`);
  console.log(`📱 Open web app to manage reminders`);
  console.log(`🤖 Telegram bot is polling for messages`);
});
