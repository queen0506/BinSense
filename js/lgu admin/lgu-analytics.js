import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let wasteChart;
const manilaDate = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});
const chartDate = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });

initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

document.addEventListener('DOMContentLoaded', () => {
<<<<<<< HEAD
    if (typeof Chart === 'function') initTrendChart();
    else setTrendStatus('Chart.js was not loaded.');
    document.getElementById('trendPeriod')?.addEventListener('change', () => refreshTrend());

    const loadBins = async () => {
        const { data, error } = await supabase.from('bins').select('id,barangay,level,volume,status');
        if (error) {
            console.error('Bin overview could not load:', error);
            setTrendStatus('Unable to load bins. Check this Supabase project and role permissions.');
            return;
        }
        processAnalytics(data || []);
=======
    const trendPeriod = document.getElementById('trendPeriod');
    let trendRequest = 0;
    let refreshTimer;

    const loadTrend = async (showLoading = true) => {
        const request = ++trendRequest;
        const { start, end, days } = getTrendPeriod(trendPeriod.value);
        if (showLoading) {
            renderTrend(days, new Map());
            setTrendStatus('Loading bin readings…');
        }

        try {
            const collection = await loadBinTrend(start, end);
            if (request !== trendRequest) return;
            renderTrend(days, readings);
            setTrendStatus(readings.size ? '' : 'No bin readings for this period.');
        } catch (error) {
            if (request !== trendRequest) return;
            console.error('Unable to load bin readings:', error);
            renderTrend(days, new Map());
            setTrendStatus('Unable to load bin readings.\nReload this page to try again.');
        }
>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
    };

    const refreshTrend = () => {
        // Batch frequent bin updates and leave the existing chart visible during refresh.
        if (refreshTimer) return;
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            loadTrend(false);
        }, 1000);
    };

    if (typeof Chart === 'function') {
        initTrendChart();
        trendPeriod.addEventListener('change', () => loadTrend());
        loadTrend();
    } else {
        trendPeriod.disabled = true;
        setTrendStatus('The chart could not start. Reload this page to try again.');
    }

    let currentPage = 1;
    const pageSize = 10;
    let totalRecords = 0;

    const loadCollectionRecords = async () => {
<<<<<<< HEAD
        const selectedBrgy = document.getElementById('brgySelector')?.value || 'all';
=======
>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
        const dateFilter = document.getElementById('dateFilter').value;
        
        const tbody = document.getElementById('collectionRecordsBody');
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888; padding: 20px;">Loading records...</td></tr>';

        // Calculate Pagination Range
        const from = (currentPage - 1) * pageSize;
        const to = from + pageSize - 1;

        // Base Query (with exact count for pagination)
        let query = supabase.from('collection_records')
            .select(`
                *,
                bins (barangay),
                notifications (barangay)
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to); 

<<<<<<< HEAD
        // 1. Barangay Filter
        // Preserve the existing filter, but apply it after fetching the joined records.
        // A filtered embedded join does not automatically filter parent collection records.
        if (selectedBrgy !== 'all') {
            query = query.eq('bins.barangay', selectedBrgy);
        }

        // 2. Date Filter Logic
=======
        // Date Filter Logic
>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
        if (dateFilter !== 'all') {
            const now = new Date();
            let startDate;

            if (dateFilter === 'today') {
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            } else if (dateFilter === 'week') {
                // Start of the current week (Sunday)
                const firstDay = new Date(now.setDate(now.getDate() - now.getDay()));
                startDate = new Date(firstDay.setHours(0,0,0,0)).toISOString();
            } else if (dateFilter === 'month') {
                // Start of the current month
                startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            }

            if (startDate) {
                query = query.gte('created_at', startDate);
            }
        }

        const { data, error, count } = await query;
        
        if (error) {
            console.error('Failed to load records:', error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ff4444;">Failed to load records.</td></tr>';
            return;
        }

        totalRecords = count || 0;
        updatePaginationUI();

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888; padding: 20px;">No collection records found.</td></tr>';
            return;
        }

                tbody.innerHTML = data.map(rec => {
            let binInfo = 'Unassigned';
            
            if (rec.bin_id) {
                const brgyName = rec.barangay || (rec.bins ? rec.bins.barangay : '');
                binInfo = `${rec.bin_id} <br><span style="color:#888; font-size:0.75rem;">${brgyName}</span>`;
            } 
            else if (rec.barangay) {
                binInfo = `<span style="color:#48742C;">Brgy. ${rec.barangay}</span>`;
            } 
            else if (rec.notifications && rec.notifications.barangay) {
                binInfo = `<span style="color:#48742C;">Brgy. ${rec.notifications.barangay}</span>`;
            }
            
            const dateObj = new Date(rec.created_at);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            return `
                <tr>
                    <td style="font-weight: 600;">${binInfo}</td>
                    <td>${dateStr} <br><span style="color:#888; font-size:0.75rem;">${timeStr}</span></td>
                    <td><span class="actual-name">${rec.actual_collector_name}</span></td>
                    <td><span class="registered-name">${rec.registered_collector_name}</span></td>
                </tr>
            `;
        }).join('');
    };

    const updatePaginationUI = () => {
        const totalPages = Math.ceil(totalRecords / pageSize) || 1;
        const pageInfo = document.getElementById('pageInfo');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');

        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = currentPage >= totalPages;
    };

    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadCollectionRecords();
        }
    });

    document.getElementById('nextPageBtn').addEventListener('click', () => {
        const totalPages = Math.ceil(totalRecords / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            loadCollectionRecords();
        }
    });

    document.getElementById('dateFilter').addEventListener('change', () => {
        currentPage = 1; 
        loadCollectionRecords();
    });

    loadCollectionRecords();
    refreshTrend();

    supabase.channel('lgu-analytics-sync')
<<<<<<< HEAD
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadBins)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bin_sensor_readings' }, refreshTrend)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_records' }, loadCollectionRecords)
        .subscribe();

    document.getElementById('brgySelector')?.addEventListener('change', () => {
        currentPage = 1; 
        loadBins();
        loadCollectionRecords(); 
    });
=======
        .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_bin_peaks' }, () => {
            if (wasteChart) refreshTrend();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_records' }, loadCollectionRecords)
        .subscribe();

>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
});

function getManilaDate(timestamp) {
    const parts = Object.fromEntries(manilaDate.formatToParts(timestamp).map(({ type, value }) => [type, value]));
    return [parts.year, parts.month, parts.day].join('-');
}

function getTrendPeriod(period, now = new Date()) {
    const today = new Date(getManilaDate(now) + 'T00:00:00Z');
    let start;
    let end;

    // UTC Date objects represent Manila calendar dates here.
    if (period.endsWith('month')) {
        const offset = period === 'last-month' ? -1 : 0;
        start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
        end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    } else {
        start = new Date(today);
        const daysSinceMonday = (start.getUTCDay() + 6) % 7;
        start.setUTCDate(start.getUTCDate() - daysSinceMonday - (period === 'last-week' ? 7 : 0));
        end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 7);
    }

    const days = [];
    for (const day = new Date(start); day < end; day.setUTCDate(day.getUTCDate() + 1)) {
        days.push(day.toISOString().slice(0, 10));
    }

    return { start: days[0], end: end.toISOString().slice(0, 10), days };
}

async function loadBinTrend(start, end) {
    const { data, error } = await supabase.rpc('lgu_daily_bin_trends', { p_start: start, p_end: end });
    if (error) throw error;
    return new Map(data.map(row => [row.reading_date, row]));
}

function initTrendChart() {
<<<<<<< HEAD
    const canvas = document.getElementById('wasteChart');
    if (!canvas) return;
    wasteChart = new Chart(canvas, {
        type: 'bar',
=======
    wasteChart = new Chart(document.getElementById('wasteChart'), {
        type: 'line',
>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
        data: {
            labels: [],
            datasets: [
                {
<<<<<<< HEAD
                    type: 'line', label: 'Average peak fill', data: [],
                    borderColor: '#48742c', backgroundColor: '#48742c',
                    yAxisID: 'fill', spanGaps: false, tension: 0.3
                },
                {
                    type: 'bar', label: 'Bins that reached full', data: [],
                    backgroundColor: '#b97523', yAxisID: 'full'
=======
                    label: 'Average peak fill',
                    data: [],
                    borderColor: '#48742c',
                    backgroundColor: '#48742c',
                    yAxisID: 'fill'
                },
                {
                    type: 'bar',
                    label: 'Bins that reached full',
                    data: [],
                    backgroundColor: '#b97523',
                    yAxisID: 'full'
>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
                }
            ]
        },
        options: {
<<<<<<< HEAD
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                fill: { position: 'left', beginAtZero: true, max: 100, ticks: { callback: value => value + '%' } },
                full: { position: 'right', beginAtZero: true, ticks: { precision: 0 }, grid: { drawOnChartArea: false } },
=======
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { boxWidth: 16, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label({ dataset, raw }) {
                            return dataset.yAxisID === 'fill'
                                ? 'Average peak fill: ' + raw + '%'
                                : 'Bins that reached full: ' + raw;
                        },
                        footer(items) {
                            const index = items[0].dataIndex;
                            return wasteChart.reportingBins[index] + ' bins reported';
                        }
                    }
                }
            },
            scales: {
                fill: { position: 'left', beginAtZero: true, max: 100, ticks: { stepSize: 25, callback: value => value + '%' } },
                full: { position: 'right', beginAtZero: true, suggestedMax: 1, grid: { drawOnChartArea: false }, ticks: { precision: 0 } },
>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
                x: { ticks: { maxTicksLimit: 8 } }
            }
        }
    });
}

<<<<<<< HEAD
function processAnalytics(bins) {
    const selectedBrgy = document.getElementById('brgySelector')?.value || 'all';
    const filtered = selectedBrgy === 'all' ? bins : bins.filter(b => b.barangay === selectedBrgy);
    
    if (filtered.length === 0) {
        if (document.getElementById('nudgeEffectiveness')) document.getElementById('nudgeEffectiveness').innerText = `0%`;
        if (document.getElementById('awarenessStatus')) document.getElementById('awarenessStatus').innerText = "No active bins detected in " + (selectedBrgy === 'all' ? "the community" : selectedBrgy) + ".";
        if (document.getElementById('statusIndicator')) document.getElementById('statusIndicator').className = 'status-dot'; 
        // Historical chart is updated independently from actual dated sensor readings.
        return;
    }

    let totalBinsChecked = filtered.length;
    let compliantBins = 0;

    filtered.forEach(bin => {
        // IMPROVED LOGIC: Real-time Health-First Compliance
        // We evaluate based on the current volume to see if it's currently a health risk.
        const currentVolume = Number(bin.level ?? bin.volume ?? 0);
        
        // Compliance = Bin is kept below 75%. 
        // 0% is now considered PERFECT compliance (Citizens/LGU acted quickly).
        if (currentVolume < 75) {
            compliantBins++;
        }
    });

    const effectivenessScore = Math.round((compliantBins / totalBinsChecked) * 100);

    // Update Compliance UI
    if (document.getElementById('nudgeEffectiveness')) document.getElementById('nudgeEffectiveness').innerText = `${effectivenessScore}%`;

    const awarenessStatus = document.getElementById('awarenessStatus');
    const statusIndicator = document.getElementById('statusIndicator');
    const planningAdvice = document.getElementById('planningAdvice');

    if (effectivenessScore >= 75) {
        if (awarenessStatus) awarenessStatus.innerText = "High Compliance: Community is successfully preventing overflow and health risks.";
        if (statusIndicator) statusIndicator.className = 'status-dot status-good';
        if (planningAdvice) planningAdvice.innerText = "Strategy: Maintain current collection frequency. The community is responding well.";
    } else {
        if (awarenessStatus) awarenessStatus.innerText = "Critical: Bins are staying full in " + selectedBrgy + ", increasing pest risks.";
        if (statusIndicator) statusIndicator.className = 'status-dot status-critical';
        if (planningAdvice) planningAdvice.innerText = "Action Required: Immediate collection needed to prevent disease spread.";
    }

    // Historical trend is retrieved separately from dated readings, never from current level.
}

// Date-grouped, server-side LGU trend values. Requires lgu_daily_bin_trends RPC
// in the same Supabase project that this website uses.
function setTrendStatus(message) {
    const status = document.getElementById('wasteChartStatus');
    if (status) {
        status.textContent = message;
        status.hidden = !message;
    } else if (message) {
        console.warn('LGU trend:', message);
    }
}

function getManilaDate(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
}

function getTrendPeriod() {
    const selection = document.getElementById('trendPeriod')?.value || 'this-week';
    const today = new Date(getManilaDate(new Date()) + 'T00:00:00Z');
    let start, end;
    if (selection.endsWith('month')) {
        const back = selection === 'last-month' ? -1 : 0;
        start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + back, 1));
        end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    } else {
        const dow = (today.getUTCDay() + 6) % 7;
        start = new Date(today.getTime() - dow * 86400000 - (selection === 'last-week' ? 7 * 86400000 : 0));
        end = new Date(start.getTime() + 7 * 86400000);
    }
    const days = [];
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
    }
    return { start: days[0], end: end.toISOString().slice(0, 10), days };
}

let trendRequestId = 0;
async function refreshTrend() {
    if (!wasteChart) return;
    const requestId = ++trendRequestId;
    const { start, end, days } = getTrendPeriod();
    setTrendStatus('Loading recorded bin trends…');
    try {
        const { data, error } = await supabase.rpc('lgu_daily_bin_trends', {
            p_start: start, p_end: end
        });
        if (requestId !== trendRequestId) return;
        if (error) throw error;
        const byDay = new Map((data || []).map(row => [String(row.reading_date).slice(0, 10), row]));
        wasteChart.data.labels = days.map(day => new Date(day + 'T00:00:00Z').toLocaleDateString('en-PH', {
            month: 'short', day: 'numeric', timeZone: 'UTC'
        }));
        wasteChart.data.datasets[0].data = days.map(day => {
            const value = byDay.get(day)?.average_peak;
            return value == null ? null : Number(value);
        });
        wasteChart.data.datasets[1].data = days.map(day => {
            const value = byDay.get(day)?.full_bins;
            return value == null ? null : Number(value);
        });
        wasteChart.update('none');
        setTrendStatus(byDay.size ? '' : 'No recorded sensor readings for this period.');
    } catch (error) {
        if (requestId !== trendRequestId) return;
        console.error('Unable to load LGU trend:', error);
        wasteChart.data.datasets.forEach(dataset => dataset.data = days.map(() => null));
        wasteChart.update('none');
        setTrendStatus('Unable to load the trend. The LGU trend RPC may be missing from this Supabase project.');
    }
}
=======
function renderTrend(days, readings) {
    wasteChart.data.labels = days.map(day => chartDate.format(new Date(day)));
    wasteChart.data.datasets[0].data = days.map(day => readings.get(day)?.average_peak ?? null);
    wasteChart.data.datasets[1].data = days.map(day => readings.get(day)?.full_bins ?? null);
    wasteChart.reportingBins = days.map(day => readings.get(day)?.reporting_bins ?? null);
    wasteChart.update('none');
}

function setTrendStatus(message) {
    const status = document.getElementById('wasteChartStatus');
    if (!status) return;

    status.textContent = message;
    status.hidden = !message;
}
>>>>>>> 48398e87d7bb1297e6d39cffa20ea16385d05962
