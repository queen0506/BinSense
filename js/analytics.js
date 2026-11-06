import { supabase } from './supabase-init.js';

async function initNotifications(user) {
    const list = document.getElementById('notificationList');
    const btn = document.getElementById('notificationBtn');
    const panel = document.getElementById('notificationPanel');
    const closeBtn = document.getElementById('closeNotificationBtn');
    const clearBtn = document.getElementById('clearAllBtn'); 

    if (btn && panel) {
        btn.onclick = (e) => {
            e.stopPropagation();
            panel.classList.toggle('active');
        };
    }
    
    if (closeBtn && panel) {
        closeBtn.onclick = () => panel.classList.remove('active');
    }

    if (clearBtn && list) {
        clearBtn.onclick = () => {
            const now = Date.now();
            localStorage.setItem(`cleared_at_${user.id}`, now);
            list.innerHTML = '<p class="empty-notification-message">Stay tuned for collection updates!</p>';
            updateBadge(0);
        };
    }

    document.addEventListener('click', (e) => {
        if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
            panel.classList.remove('active');
        }
    });

    const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    const userBarangay = userData?.barangay || userData?.profile?.barangay;
    if (list) list.innerHTML = '<p class="empty-notification-message">Stay tuned for other updates!</p>';

    loadNotifications('Global', user.id);

    if (!userBarangay) {
        addNotificationUI("Location Missing", "Set your Barangay in profile.", "warning", "📍");
    } else {
        loadNotifications(userBarangay, user.id);
    }

    supabase
        .channel('public:notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
            const data = payload.new;
            if (data.barangay === 'Global' || data.barangay === userBarangay) {
                const clearedAt = parseInt(localStorage.getItem(`cleared_at_${user.id}`)) || 0;
                const createdAt = new Date(data.created_at || Date.now()).getTime();

                if (createdAt > clearedAt) {
                    const type = data.type === 'cancellation' ? 'alert' : 'warning';
                    const icon = data.type === 'cancellation' ? '✕' : '📅';
                    addNotificationUI(data.title, formatNotificationMessage(data), type, icon);
                }
            }
        })
        .subscribe();
}

async function loadNotifications(barangay, userId) {
    const clearedAt = parseInt(localStorage.getItem(`cleared_at_${userId}`)) || 0;

    const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('barangay', barangay)
        .order('created_at', { ascending: false })
        .limit(barangay === 'Global' ? 5 : 10);

    if (notifications && notifications.length > 0) {
        notifications.reverse().forEach(data => {
            const createdAt = new Date(data.created_at || Date.now()).getTime();
            if (createdAt <= clearedAt) return;

            const type = data.type === 'cancellation' ? 'alert' : 'warning';
            const icon = data.type === 'cancellation' ? '✕' : '📅';
            addNotificationUI(data.title, formatNotificationMessage(data), type, icon);
        });
    }
}

function formatNotificationMessage(notification) {
    if (notification.type === 'collection' && notification.time && !notification.message.includes(' at ')) {
        return `${notification.message} at ${notification.time}`;
    }
    return notification.message;
}

function addNotificationUI(title, message, type, icon) {
    const list = document.getElementById('notificationList');
    if (!list) return;

    const emptyMsg = list.querySelector('.empty-notification-message');
    if (emptyMsg) emptyMsg.remove();

    const existing = Array.from(list.querySelectorAll('.notification-message'));
    if (existing.some(p => p.innerText === message)) return;

    const item = document.createElement('div');
    item.className = 'notification-item unread';
    item.innerHTML = `
        <div class="notification-icon-circle ${type}">${icon}</div>
        <div class="notification-content">
            <span class="notification-title">${title}</span>
            <p class="notification-message">${message}</p>
        </div>
    `;
    list.prepend(item);
    updateBadge(list.querySelectorAll('.notification-item').length);
}

function updateBadge(count) {
    const btn = document.getElementById('notificationBtn');
    if (!btn) return;

    let badge = btn.querySelector('.notification-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notification-badge';
            btn.appendChild(badge);
        }
        badge.innerText = count;
    } else if (badge) {
        badge.remove();
    }
}

// ==========================================
// YOUR ORIGINAL ANALYTICS LOGIC STARTS HERE
// ==========================================

// --- 1. Chart Initialization ---
const ctx = document.getElementById('binChart').getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 0, 300);
gradient.addColorStop(0, 'rgba(153, 204, 51, 0.4)');
gradient.addColorStop(1, 'rgba(153, 204, 51, 0)');

const binChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], // FIXED LABELS
        datasets: [{
            label: 'Avg Daily Fill (%)',
            data: [0, 0, 0, 0, 0, 0, 0], 
            borderColor: '#99cc33',
            borderWidth: 4,
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: '#99cc33'
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: { 
                beginAtZero: true, 
                max: 100, 
                ticks: { stepSize: 25, callback: (v) => v + '%' } 
            }
        }
    }
});

// --- 2. Auth Initializer ---
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
        // Initialize Notifications for Analytics Page
        initNotifications(user);

        // Query user_connected_bins table
        const { data: connectedBins } = await supabase
            .from('user_connected_bins')
            .select('bin_id')
            .eq('user_id', user.id);

        if (connectedBins && connectedBins.length > 0) {
            const firstBinId = connectedBins[0].bin_id;
            startTracking(firstBinId);
        }
    }
});

// --- 3. Persistent Data Logic ---
async function startTracking(activeBinId) {
    const now = new Date();
    // JS: 0=Sun, 1=Mon... Mapping to Mon=0, Tue=1, Sun=6
    const chartIndex = now.getDay() === 0 ? 6 : now.getDay() - 1; 

    // A. Weekly Reset Logic (Prevents daily wipes, persists for 7 days)
    const currentWeek = getWeekNumber(now);
    const lastResetWeek = localStorage.getItem('last_reset_week');

    if (lastResetWeek !== String(currentWeek)) {
        await supabase
            .from('bin_history')
            .upsert({
                bin_id: activeBinId,
                data: [0, 0, 0, 0, 0, 0, 0],
                counts: [0, 0, 0, 0, 0, 0, 0]
            });
        localStorage.setItem('last_reset_week', currentWeek);
    }

    // B. Sync Weekly Data to Chart
    const fetchHistory = async () => {
        const { data: history } = await supabase
            .from('bin_history')
            .select('data, counts')
            .eq('bin_id', activeBinId)
            .single();

        if (history && history.data && history.counts) {
            const averages = history.data.map((total, i) => 
                history.counts[i] > 0 ? Math.round(total / history.counts[i]) : 0
            );
            binChart.data.datasets[0].data = averages;
            binChart.update(); 
        }
    };

    await fetchHistory();

    // Listen for realtime bin_history changes
    supabase
        .channel(`bin-history-${activeBinId}`)
        .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'bin_history', 
            filter: `bin_id=eq.${activeBinId}` 
        }, () => {
            fetchHistory();
        })
        .subscribe();

    // C. Real-time Accumulation
    supabase
        .channel(`bin-status-${activeBinId}`)
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'bins', 
            filter: `id=eq.${activeBinId}` 
        }, async (payload) => {
            const statusVal = payload.new?.status;
            if (statusVal === null || statusVal === undefined) return;

            let currentLevel = parseStatus(statusVal);

            const { data: snap } = await supabase
                .from('bin_history')
                .select('data, counts')
                .eq('bin_id', activeBinId)
                .single();

            let historyData = snap || { data: [0,0,0,0,0,0,0], counts: [0,0,0,0,0,0,0] };

            // Update ONLY today's specific index
            historyData.data[chartIndex] += currentLevel;
            historyData.counts[chartIndex] += 1;

            await supabase
                .from('bin_history')
                .upsert({
                    bin_id: activeBinId,
                    data: historyData.data,
                    counts: historyData.counts
                });
            
            const todayAvg = Math.round(historyData.data[chartIndex] / historyData.counts[chartIndex]);
            updateEfficiencyUI(currentLevel, todayAvg);
        })
        .subscribe();
}

// --- 4. Helpers ---
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function parseStatus(val) {
    const s = String(val).toLowerCase();
    if (s === 'full') return 100;
    if (s === 'filling') return 50;
    if (s === 'available') return 0;
    return parseInt(s.match(/\d+/) || 0);
}

function updateEfficiencyUI(current, avg) {
    const title = document.querySelector('.status-text h3');
    const desc = document.querySelector('.status-text p');
    if (!title || !desc) return;

    if (current >= 90) {
        title.innerText = "Bin is full!";
        desc.innerText = "Your usage is currently peaking. Collect the trash now!";
    } else {
        title.innerText = "You're doing great!";
        desc.innerText = `Today's average usage is ${avg}%. Keep collecting responsibly!`;
    }
}