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
    const trendPeriod = document.getElementById('trendPeriod');
    let trendRequest = 0;
    let refreshTimer;

    const loadTrend = async (showLoading = true) => {
        const request = ++trendRequest;
        const { start, end, days } = getTrendPeriod(trendPeriod.value);
        if (showLoading) {
            renderTrend(days, new Map());
            setTrendStatus('Loading collection readings…');
        }

        try {
            const collection = await loadCollectionTrend(start, end);
            if (request !== trendRequest) return;
            renderTrend(days, collection);
            setTrendStatus(collection.size ? '' : 'No collection readings for this period.');
        } catch (error) {
            if (request !== trendRequest) return;
            console.error('Unable to load collection readings:', error);
            renderTrend(days, new Map());
            setTrendStatus('Unable to load collection readings. Reload this page to try again.');
        }
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

        // Date Filter Logic
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

    supabase.channel('lgu-analytics-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_logs' }, () => {
            if (wasteChart) refreshTrend();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_records' }, loadCollectionRecords)
        .subscribe();

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

async function loadCollectionTrend(start, end) {
    const daily = new Map();
    const pageSize = 500;
    let lastId;

    while (true) {
        let query = supabase.from('collection_logs')
            .select('id, collected_at, waste_level_at_collection')
            .gte('collected_at', new Date(start + 'T00:00:00+08:00').toISOString())
            .lt('collected_at', new Date(end + 'T00:00:00+08:00').toISOString())
            .eq('action', 'Collection Completed')
            .gte('waste_level_at_collection', 0)
            .lte('waste_level_at_collection', 100)
            .order('id')
            .limit(pageSize);
        if (lastId !== undefined) query = query.gt('id', lastId);

        const { data, error } = await query;
        if (error) throw error;
        if (!data.length) break;

        for (const row of data) {
            const day = getManilaDate(new Date(row.collected_at));
            const values = daily.get(day) || { total: 0, count: 0 };
            values.total += row.waste_level_at_collection;
            values.count++;
            daily.set(day, values);
        }
        lastId = data.at(-1).id;
    }

    return new Map([...daily].map(([day, values]) => [day, Math.round(values.total / values.count)]));
}

function initTrendChart() {
    wasteChart = new Chart(document.getElementById('wasteChart'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'At collection', data: [], borderColor: '#48742c', backgroundColor: '#48742c' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { boxWidth: 16, usePointStyle: true } } },
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { stepSize: 25, callback: value => value + '%' } },
                x: { ticks: { maxTicksLimit: 8 } }
            }
        }
    });
}

function renderTrend(days, collection) {
    wasteChart.data.labels = days.map(day => chartDate.format(new Date(day)));
    wasteChart.data.datasets[0].data = days.map(day => collection.get(day) ?? null);
    wasteChart.update('none');
}

function setTrendStatus(message) {
    const status = document.getElementById('wasteChartStatus');
    if (!status) return;

    status.textContent = message;
    status.hidden = !message;
}