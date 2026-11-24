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
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const statisticsBinPicker = document.getElementById('statisticsBinPicker');
const statisticsBin = document.getElementById('statisticsBin');
let activeBinId = null;
let statisticsChannel = null;
let statisticsRequest = 0;
let activePeriod = 'weekly';
let retryStatistics = null;

function setChartState(state, message, retryAction = null) {
    if (chartContainer) chartContainer.dataset.state = state;
    if (chartStateMessage) chartStateMessage.textContent = message;
    retryStatistics = retryAction;
    if (retryStatisticsBtn) {
        retryStatisticsBtn.hidden = state !== 'error';
        retryStatisticsBtn.disabled = false;
    }
}

function setInsight(title, message) {
    insightTitle.textContent = title;
    insightMessage.textContent = message;
}

retryStatisticsBtn?.addEventListener('click', () => {
    if (retryStatistics) {
        retryStatisticsBtn.disabled = true;
        retryStatistics();
    }
});

document.querySelectorAll('.period-option[data-period]').forEach((button) => {
    button.addEventListener('click', () => {
        if (button.classList.contains('is-active') || !activeBinId) return;

        activePeriod = button.dataset.period;
        document.querySelectorAll('.period-option[data-period]').forEach((option) => {
            const isActive = option === button;
            option.classList.toggle('is-active', isActive);
            option.setAttribute('aria-pressed', String(isActive));
        });
        fetchSensorStatistics(true);
    });
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

            chartPointDetail.textContent = `${chartLabels[dataIndex]} · Average recorded fill: ${value}%`;
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
                    title: (items) => chartLabels[items[0].dataIndex],
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
            initNotifications(user).catch(error => console.warn('Notifications unavailable:', error));
        }

        // Query user_connected_bins table
        const { data: connectedBins, error: connectedBinsError } = await supabase
            .from('user_connected_bins')
            .select('bin_id')
            .eq('user_id', user.id)
            .order('bin_id');
        if (connectedBinsError) throw connectedBinsError;

        if (!connectedBins || connectedBins.length === 0) {
            binChart.data.datasets[0].data = chartLabels.map(() => null);
            binChart.update();
            setChartState('empty', 'No connected bins are available for this account.');
            setInsight('No connected bin', 'Connect a bin from Home to start viewing recorded monitoring data.');
            return;
        }

        statisticsBin.replaceChildren(...connectedBins.map(({ bin_id }) => new Option(`Smart Bin #${bin_id.replace(/^bin_/i, '')}`, bin_id)));
        if (connectedBins.some(({ bin_id }) => bin_id === activeBinId)) statisticsBin.value = activeBinId;
        statisticsBinPicker.hidden = false;
        await startTracking(statisticsBin.value);
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
statisticsBin.addEventListener('change', () => startTracking(statisticsBin.value));

const statisticsRefreshTimer = window.setInterval(() => {
    if (!document.hidden) fetchSensorStatistics();
}, 30000);

window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    window.clearInterval(statisticsRefreshTimer);
    if (statisticsChannel) supabase.removeChannel(statisticsChannel);
});

async function startTracking(selectedBinId) {
    if (statisticsChannel) supabase.removeChannel(statisticsChannel);
    window.activeStatisticsBinId = selectedBinId;
    activeBinId = selectedBinId;
    const initialLoad = fetchSensorStatistics(true);

    // Telemetry writes the reading and updates the bin in the same transaction.
    statisticsChannel = supabase
        .channel(`statistics-bin-${selectedBinId}-${statisticsRequest}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'bins',
            filter: `id=eq.${selectedBinId}`
        }, () => {
            if (activeBinId === selectedBinId) fetchSensorStatistics();
        })
        .subscribe();

    await initialLoad;
}

function getManilaNow() {
    return new Date(Date.now() + MANILA_OFFSET_MS);
}

function startOfManilaDay(now = getManilaNow()) {
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        MANILA_OFFSET_MS
    );
}

function getPeriodRange(period, now = getManilaNow()) {
    if (period === 'daily') {
        const start = startOfManilaDay(now);
        return {
            start,
            end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
            labels: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)
        };
    }

    if (period === 'monthly') {
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth();
        const start = new Date(Date.UTC(year, month, 1) - MANILA_OFFSET_MS);
        const end = new Date(Date.UTC(year, month + 1, 1) - MANILA_OFFSET_MS);
        const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        return {
            start,
            end,
            labels: Array.from({ length: days }, (_, index) => String(index + 1))
        };
    }

    const todayStart = startOfManilaDay(now);
    const mondayIndex = (now.getUTCDay() + 6) % 7;
    const start = new Date(todayStart.getTime() - mondayIndex * 24 * 60 * 60 * 1000);
    return {
        start,
        end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000),
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    };
}

function aggregateSensorReadings(readings, period, range) {
    const averages = Array(range.labels.length).fill(null);
    const exactAverages = Array(range.labels.length).fill(null);
    const counts = Array(range.labels.length).fill(0);

    readings.forEach((bucket) => {
        const average = Number(bucket.average_fill_level);
        const count = Number(bucket.reading_count);
        if (!Number.isFinite(average) || !Number.isFinite(count) || count <= 0) return;
        if (average < 0 || average > 100) return;

        const timestamp = Date.parse(bucket.bucket_start);
        if (!Number.isFinite(timestamp)) return;

        const local = new Date(timestamp + MANILA_OFFSET_MS);
        let index = -1;

        if (period === 'daily') {
            index = local.getUTCHours();
        } else if (period === 'weekly') {
            const localDate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
            const startLocal = new Date(range.start.getTime() + MANILA_OFFSET_MS);
            const startDate = Date.UTC(
                startLocal.getUTCFullYear(),
                startLocal.getUTCMonth(),
                startLocal.getUTCDate()
            );
            index = Math.floor((localDate - startDate) / (24 * 60 * 60 * 1000));
        } else {
            index = local.getUTCDate() - 1;
        }

        if (index >= 0 && index < averages.length) {
            averages[index] = Math.round(average);
            exactAverages[index] = average;
            counts[index] = count;
        }
    });

    return { averages, exactAverages, counts };
}

async function fetchSensorStatistics(showLoading = false) {
    if (!activeBinId) return;
    const request = ++statisticsRequest;

    if (showLoading) {
        setChartState('loading', 'Loading recorded sensor readings…');
    }

    const requestedBin = activeBinId;
    const requestedPeriod = activePeriod;
    const range = getPeriodRange(requestedPeriod);
    if (showLoading) {
        chartLabels.splice(0, chartLabels.length, ...range.labels);
        binChart.data.labels = chartLabels;
        binChart.data.datasets[0].data = chartLabels.map(() => null);
        chartPointDetail.hidden = true;
        binChart.update('none');
    }

    try {
        const [{ data: buckets, error: readingError }, { data: bin, error: binError }] = await Promise.all([
            supabase.rpc('get_bin_sensor_reading_averages', {
                p_bin_id: requestedBin,
                p_granularity: requestedPeriod === 'daily' ? 'hour' : 'day',
                p_start: range.start.toISOString(),
                p_end: range.end.toISOString()
            }),
            supabase
                .from('bins')
                .select('last_sync')
                .eq('id', requestedBin)
                .maybeSingle()
        ]);

        if (request !== statisticsRequest) return;
        if (readingError) {
            if (readingError.code === 'PGRST202' || readingError.code === '42883') {
                throw new Error('Sensor statistics RPC is not installed or exposed in the Supabase project used by this website.');
            }
            throw readingError;
        }
        if (binError) throw binError;

        const staleTimestamp = bin?.last_sync ? Date.parse(bin.last_sync) : NaN;
        const isStale = !Number.isFinite(staleTimestamp) ||
            Date.now() - staleTimestamp > 60 * 1000;
        const lastSyncLabel = Number.isFinite(staleTimestamp)
            ? new Date(staleTimestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
            : 'No sensor sync timestamp is available';

        const aggregate = aggregateSensorReadings(buckets ?? [], requestedPeriod, range);
        chartLabels.splice(0, chartLabels.length, ...range.labels);
        binChart.data.labels = chartLabels;
        binChart.data.datasets[0].data = aggregate.averages;
        binChart.update('none');
        chartPointDetail.hidden = true;

        if (!aggregate.counts.some(count => count > 0)) {
            if (isStale) {
                setChartState(
                    'offline',
                    'The hardware is offline or stale. No readings are available for this period.'
                );
                setInsight(
                    'Previously recorded readings',
                    `Last sensor sync: ${lastSyncLabel}.`
                );
                chartPointDetail.hidden = true;
                return;
            }

            setChartState('empty', 'No recorded sensor readings are available for this period.');
            setInsight('No sensor readings', 'Actual fill-level readings will appear after the telemetry system records them.');
            chartPointDetail.hidden = true;
            return;
        }

        const validCount = aggregate.averages.filter((value) => value !== null).length;
        const totalReadings = aggregate.counts.reduce((sum, count) => sum + count, 0);
        const weightedTotal = aggregate.exactAverages.reduce(
            (sum, value, index) =>
                value === null ? sum : sum + value * aggregate.counts[index],
            0
        );
        const periodAverage = totalReadings
            ? Math.round(weightedTotal / totalReadings)
            : null;

        setChartState('ready', '');
        setInsight(
            'Recorded fill-level trend',
            periodAverage === null
                ? `${validCount} periods contain recorded readings.`
                : `Average recorded fill across the loaded period: ${periodAverage}%.`
        );

        if (isStale) {
            setChartState('offline', 'Showing previously recorded readings. The bin is currently offline or stale.');
            setInsight(
                'Previously recorded readings',
                `Last sensor sync: ${lastSyncLabel}.`
            );
        }
    } catch (error) {
        if (request !== statisticsRequest) return;
        console.error('Unable to load sensor readings:', error);
        const message = /RPC is not installed/.test(error.message ?? '')
            ? 'The connected Supabase project is missing the sensor statistics function.'
            : 'Sensor readings could not be loaded. Try again.';
        setChartState('error', message, () => fetchSensorStatistics(true));
        setInsight('Statistics unavailable', 'An error prevented the recorded sensor readings from loading.');
    }
}