const API_URL = window.location.origin;

let reminders = [];

const chatIdInput = document.getElementById('chatId');
const reminderNameInput = document.getElementById('reminderName');
const hourSelect = document.getElementById('hour');
const minuteSelect = document.getElementById('minute');
const detailsInput = document.getElementById('details');
const notesInput = document.getElementById('notes');
const addBtn = document.getElementById('addBtn');
const testBtn = document.getElementById('testBtn');
const reminderList = document.getElementById('reminderList');

addBtn.addEventListener('click', addReminder);
testBtn.addEventListener('click', sendTest);

document.addEventListener('DOMContentLoaded', () => {
    const savedChatId = localStorage.getItem('telegram_chat_id');
    if (savedChatId) {
        chatIdInput.value = savedChatId;
        loadReminders(savedChatId);
    }
});

chatIdInput.addEventListener('change', () => {
    localStorage.setItem('telegram_chat_id', chatIdInput.value);
    loadReminders(chatIdInput.value);
});

async function addReminder() {
    const chatId = chatIdInput.value.trim();
    const reminderName = reminderNameInput.value.trim();
    const hour = hourSelect.value;
    const minute = minuteSelect.value;
    const details = detailsInput.value.trim();
    const notes = notesInput.value.trim();
    
    if (!chatId) {
        alert('Please enter your Telegram Chat ID');
        return;
    }
    if (!reminderName) {
        alert('Please enter reminder name');
        return;
    }
    if (!hour || !minute) {
        alert('Please select time');
        return;
    }
    
    const reminderTime = `${hour}:${minute}`;
    
    try {
        const response = await fetch(`${API_URL}/api/reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                reminder_name: reminderName,
                reminder_time: reminderTime,
                details: details,
                notes: notes
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ Reminder added!\n\n📋 ${reminderName}\n⏰ ${reminderTime}\n\nYou will get Telegram reminder at this time.`);
            
            reminderNameInput.value = '';
            detailsInput.value = '';
            notesInput.value = '';
            
            loadReminders(chatId);
        } else {
            alert('❌ Error adding reminder');
        }
    } catch (err) {
        console.error('Error:', err);
        alert('❌ Network error. Please try again.');
    }
}

async function sendTest() {
    const chatId = chatIdInput.value.trim();
    
    if (!chatId) {
        alert('Please enter your Telegram Chat ID first');
        return;
    }
    
    alert('🧪 Sending test reminder to your Telegram...\n\nCheck your Telegram app now!');
}

async function loadReminders(chatId) {
    if (!chatId) return;
    
    try {
        const response = await fetch(`${API_URL}/api/reminders/${chatId}`);
        reminders = await response.json();
        renderReminders();
    } catch (err) {
        console.error('Error loading reminders:', err);
    }
}

function renderReminders() {
    if (reminders.length === 0) {
        reminderList.innerHTML = `
            <div class="empty-state">
                <div class="icon">📭</div>
                <p>No reminders yet. Add one above!</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    reminders.forEach((reminder, index) => {
        html += `
            <div class="reminder-item">
                <div class="reminder-info">
                    <h3>${escapeHtml(reminder.reminder_name)}</h3>
                    <p>${reminder.details ? '📌 ' + escapeHtml(reminder.details) : ''}</p>
                    <p>${reminder.notes ? '📝 ' + escapeHtml(reminder.notes) : ''}</p>
                </div>
                <div style="display: flex; align-items: center;">
                    <div class="reminder-time">${reminder.reminder_time}</div>
                    <button class="delete-btn" onclick="deleteReminder(${reminder.id})">🗑️</button>
                </div>
            </div>
        `;
    });
    
    reminderList.innerHTML = html;
}

async function deleteReminder(id) {
    if (!confirm('Are you sure you want to delete this reminder?')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/reminders/${id}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            loadReminders(chatIdInput.value);
        }
    } catch (err) {
        console.error('Error deleting:', err);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
