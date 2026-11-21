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

const chartContainer = document.getElementById('chartContainer');
const chartStateMessage = document.getElementById('chartStateMessage');
const retryStatisticsBtn = document.getElementById('retryStatisticsBtn');
const chartPointDetail = document.getElementById('chartPointDetail');
const insightTitle = document.getElementById('insightTitle');
const insightMessage = document.getElementById('insightMessage');
const chartLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fullDayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let retryStatistics = null;

function setChartState(state, message, retryAction = null) {
    chartContainer.dataset.state = state;
    chartStateMessage.textContent = message;
    retryStatistics = retryAction;
    retryStatisticsBtn.hidden = state !== 'error';
    retryStatisticsBtn.disabled = false;
}

function setInsight(title, message) {
    insightTitle.textContent = title;
    insightMessage.textContent = message;
}

retryStatisticsBtn.addEventListener('click', () => {
    if (retryStatistics) {
        retryStatisticsBtn.disabled = true;
        retryStatistics();
    }
});

// --- 1. Chart Initialization ---
const ctx = document.getElementById('binChart').getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 0, 300);
gradient.addColorStop(0, 'rgba(153, 204, 51, 0.28)');
gradient.addColorStop(1, 'rgba(153, 204, 51, 0)');

const binChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: chartLabels,
        datasets: [{
            label: 'Average recorded fill',
            data: [null, null, null, null, null, null, null],
            borderColor: '#99cc33',
            borderWidth: 3,
            backgroundColor: gradient,
            fill: true,
            tension: 0.32,
            spanGaps: false,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointHitRadius: 14,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#79aa32',
            pointBorderWidth: 2.5,
            pointHoverBackgroundColor: '#99cc33',
            pointHoverBorderColor: '#fff'
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450,
            easing: 'easeOutQuart'
        },
        interaction: {
            mode: 'nearest',
            intersect: true
        },
        onClick: (event, elements, chart) => {
            if (!elements.length) return;

            const { dataIndex, datasetIndex } = elements[0];
            const value = chart.data.datasets[datasetIndex].data[dataIndex];
            if (value === null || value === undefined) return;

            chartPointDetail.textContent = `${fullDayLabels[dataIndex]} · Average recorded fill: ${value}%. Exact calendar dates are not available.`;
            chartPointDetail.hidden = false;
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#243323',
                titleColor: '#fff',
                bodyColor: '#edf5e6',
                padding: 12,
                displayColors: false,
                callbacks: {
                    title: (items) => `${fullDayLabels[items[0].dataIndex]} · stored weekday`,
                    label: (context) => `${context.dataset.label}: ${context.parsed.y}%`
                }
            }
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: { color: '#758174', font: { size: 11 } },
                border: { display: false }
            },
            y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                    stepSize: 25,
                    color: '#758174',
                    callback: (value) => `${value}%`
                },
                grid: { color: '#edf1e9', drawTicks: false },
                border: { display: false }
            }
        }
    }
});

// --- 2. Auth Initializer ---
document.addEventListener('DOMContentLoaded', loadStatistics);

let notificationsInitialized = false;

async function loadStatistics() {
    setChartState('loading', 'Loading recorded readings…');
    setInsight('Loading bin statistics', 'Waiting for the connected bin data to load.');

    try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;

        if (!user) {
            setChartState('empty', 'Sign in to view connected-bin statistics.');
            setInsight('Sign-in required', 'Statistics are available for the bins connected to your account.');
            return;
        }

        if (!notificationsInitialized) {
            notificationsInitialized = true;
            initNotifications(user);
        }

        // Query user_connected_bins table
        const { data: connectedBins, error: connectedBinsError } = await supabase
            .from('user_connected_bins')
            .select('bin_id')
            .eq('user_id', user.id);
        if (connectedBinsError) throw connectedBinsError;

        if (!connectedBins || connectedBins.length === 0) {
            binChart.data.datasets[0].data = chartLabels.map(() => null);
            binChart.update();
            setChartState('empty', 'No connected bins are available for this account.');
            setInsight('No connected bin', 'Connect a bin from Home to start viewing recorded monitoring data.');
            return;
        }

        await startTracking(connectedBins[0].bin_id);
    } catch (error) {
        if (error?.name === 'AuthSessionMissingError') {
            setChartState('empty', 'Sign in to view connected-bin statistics.');
            setInsight('Sign-in required', 'Statistics are available for the bins connected to your account.');
            return;
        }

        console.error('Unable to load statistics:', error);
        setChartState('error', 'Statistics could not be loaded. Check your connection and try again.', loadStatistics);
        setInsight('Statistics unavailable', 'A data error prevented the dashboard from loading readings.');
    }
}

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
    const fetchHistory = async (showLoading = false) => {
        if (showLoading) setChartState('loading', 'Loading recorded readings...');

        const { data: history, error: historyError } = await supabase
            .from('bin_history')
            .select('data, counts')
            .eq('bin_id', activeBinId)
            .single();

        if (historyError && historyError.code !== 'PGRST116') {
            console.error('Unable to load weekly bin history:', historyError);
            setChartState('error', 'Weekly readings could not be loaded. Try again.', () => fetchHistory(true));
            setInsight('Statistics unavailable', 'A data error prevented the weekly readings from loading.');
            return;
        }

        if (!history) {
            binChart.data.datasets[0].data = chartLabels.map(() => null);
            binChart.update();
            setChartState('empty', 'No waste monitoring data is available for this period yet.');
            setInsight('No readings yet', 'The connected bin has not recorded weekday readings for this period.');
            return;
        }

        if (!Array.isArray(history.data) || !Array.isArray(history.counts)
            || history.data.length !== chartLabels.length || history.counts.length !== chartLabels.length) {
            const historyShapeError = new Error('Stored bin history does not contain seven weekday values and counts.');
            console.error('Unable to display weekly bin history:', historyShapeError);
            setChartState('error', 'The stored weekly readings are not in the expected format.', () => fetchHistory(true));
            setInsight('Statistics unavailable', 'The saved readings could not be displayed.');
            return;
        }

        const averages = history.data.map((total, i) =>
            history.counts[i] > 0 ? Math.round(total / history.counts[i]) : null
        );
        const hasReadings = history.counts.some(count => count > 0);

        binChart.data.datasets[0].data = averages;
        binChart.update();
        chartPointDetail.hidden = true;

        if (hasReadings) {
            setChartState('ready', '');
            setInsight('Weekly readings available', 'The chart shows averages of recorded status-based fill readings. Days without samples are left blank.');
        } else {
            setChartState('empty', 'No waste monitoring data is available for this period yet.');
            setInsight('No readings yet', 'No samples were recorded for the displayed weekdays.');
        }
    };

    await fetchHistory(true);

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
    const title = document.getElementById('insightTitle');
    const desc = document.getElementById('insightMessage');
    if (!title || !desc) return;

    if (current >= 90) {
        title.textContent = 'High bin fill status';
        desc.textContent = `Latest recorded fill status: ${current}%. Today's recorded average: ${avg}%.`;
    } else {
        title.textContent = current === 0 ? 'Bin status: Available' : 'Latest status recorded';
        desc.textContent = `Latest recorded fill status: ${current}%. Today's recorded average: ${avg}%.`;
    }
}