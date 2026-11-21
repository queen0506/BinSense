import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let wasteChart;
const ctx = document.getElementById('wasteChart').getContext('2d');

initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

document.addEventListener('DOMContentLoaded', () => {
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
    };

        // PAGINATION & FILTER STATE
    let currentPage = 1;
    const pageSize = 10;
    let totalRecords = 0;

    const loadCollectionRecords = async () => {
        const selectedBrgy = document.getElementById('brgySelector')?.value || 'all';
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

        // 1. Barangay Filter
        // Preserve the existing filter, but apply it after fetching the joined records.
        // A filtered embedded join does not automatically filter parent collection records.
        if (selectedBrgy !== 'all') {
            query = query.eq('bins.barangay', selectedBrgy);
        }

        // 2. Date Filter Logic
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

    loadBins();
    loadCollectionRecords();
    refreshTrend();

    supabase.channel('lgu-analytics-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadBins)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bin_sensor_readings' }, refreshTrend)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_records' }, loadCollectionRecords)
        .subscribe();

    document.getElementById('brgySelector')?.addEventListener('change', () => {
        currentPage = 1; 
        loadBins();
        loadCollectionRecords(); 
    });
});

function initTrendChart() {
    const canvas = document.getElementById('wasteChart');
    if (!canvas) return;
    wasteChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    type: 'line', label: 'Average peak fill', data: [],
                    borderColor: '#48742c', backgroundColor: '#48742c',
                    yAxisID: 'fill', spanGaps: false, tension: 0.3
                },
                {
                    type: 'bar', label: 'Bins that reached full', data: [],
                    backgroundColor: '#b97523', yAxisID: 'full'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                fill: { position: 'left', beginAtZero: true, max: 100, ticks: { callback: value => value + '%' } },
                full: { position: 'right', beginAtZero: true, ticks: { precision: 0 }, grid: { drawOnChartArea: false } },
                x: { ticks: { maxTicksLimit: 8 } }
            }
        }
    });
}

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
