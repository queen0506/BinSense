import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let wasteChart;
let trendRequestId = 0;
let trendRefreshTimer;
let currentFilter = 'all';

const manilaDate = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});
const chartDate = new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
});

initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

function setCollectionCsvAvailability(available) {
    const button = document.getElementById('exportCollectionCsvBtn');
    if (button) button.disabled = !available;
}

function escapeCsvField(value) {
    let text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function getLocalDateStamp(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getCollectionTimeframe(filterType) {
    const labels = {
        today: 'Daily',
        week: 'Weekly',
        month: 'Monthly',
        all: 'AllTime'
    };
    return labels[filterType] || (filterType.charAt(0).toUpperCase() + filterType.slice(1));
}

function exportCollectionCsv() {
    const tableBody = document.getElementById('collectionRecordsBody');
    if (!tableBody) return;

    const dataRows = Array.from(tableBody.querySelectorAll('tr')).filter(row =>
        row.querySelectorAll('td').length === 4
    );

    if (dataRows.length === 0) {
        alert('No collection records to export.');
        return;
    }

    const headers = ['Bin / Barangay', 'Date & Time', 'Actual Collector', 'Registered To'];
    const rows = dataRows.map(row =>
        Array.from(row.querySelectorAll('td'))
            .map(cell => (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim())
            .map(escapeCsvField)
            .join(',')
    );

    const csvContent = '\uFEFF' + [
        headers.map(escapeCsvField).join(','),
        ...rows
    ].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    const timeframe = getCollectionTimeframe(currentFilter);
    link.download = `BinSense_CollectionLog_${timeframe}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart !== 'function') {
        setTrendStatus('Chart.js was not loaded. Reload this page to try again.');
    } else {
        initTrendChart();
        document.getElementById('trendPeriod')?.addEventListener('change', refreshTrend);
        refreshTrend();
    }

    let currentPage = 1;
    const pageSize = 10;
    let totalRecords = 0;

    const loadCollectionRecords = async () => {
        const dateFilter = document.getElementById('dateFilter').value;
        const tbody = document.getElementById('collectionRecordsBody');
        setCollectionCsvAvailability(false);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888; padding: 20px;">Loading records...</td></tr>';

        const from = (currentPage - 1) * pageSize;
        const to = from + pageSize - 1;
        let query = supabase.from('collection_records')
            .select(`
                *,
                bins (barangay),
                notifications (barangay)
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);

        if (dateFilter !== 'all') {
            const now = new Date();
            let startDate;

            if (dateFilter === 'today') {
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            } else if (dateFilter === 'week') {
                const firstDay = new Date(now);
                firstDay.setDate(firstDay.getDate() - firstDay.getDay());
                firstDay.setHours(0, 0, 0, 0);
                startDate = firstDay.toISOString();
            } else if (dateFilter === 'month') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            }

            if (startDate) query = query.gte('created_at', startDate);
        }

        const { data, error, count } = await query;
        if (error) {
            console.error('Failed to load records:', error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ff4444;">Failed to load records.</td></tr>';
            return;
        }

        totalRecords = count || 0;
        updatePaginationUI();

        if (!data?.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888; padding: 20px;">No collection records found.</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(rec => {
            let binInfo = 'Unassigned';

            if (rec.bin_id) {
                const brgyName = rec.barangay || (rec.bins ? rec.bins.barangay : '');
                binInfo = `${rec.bin_id} <br><span style="color:#888; font-size:0.75rem;">${brgyName}</span>`;
            } else if (rec.barangay) {
                binInfo = `<span style="color:#48742C;">Brgy. ${rec.barangay}</span>`;
            } else if (rec.notifications?.barangay) {
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

        setCollectionCsvAvailability(true);
    };

    const updatePaginationUI = () => {
        const totalPages = Math.ceil(totalRecords / pageSize) || 1;
        document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
        document.getElementById('prevPageBtn').disabled = currentPage === 1;
        document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
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
        currentFilter = document.getElementById('dateFilter').value;
        loadCollectionRecords();
    });

    document.getElementById('exportCollectionCsvBtn')?.addEventListener('click', exportCollectionCsv);

    loadCollectionRecords();

    supabase.channel('lgu-analytics-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_bin_peaks' }, scheduleTrendRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_records' }, loadCollectionRecords)
        .subscribe();
});

function getManilaDate(timestamp) {
    const parts = Object.fromEntries(manilaDate.formatToParts(timestamp).map(({ type, value }) => [type, value]));
    return [parts.year, parts.month, parts.day].join('-');
}

function getTrendPeriod(period, now = new Date()) {
    const today = new Date(`${getManilaDate(now)}T00:00:00Z`);
    let start;
    let end;

    if (period.endsWith('month')) {
        const monthOffset = period === 'last-month' ? -1 : 0;
        start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthOffset, 1));
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

    return new Map((data || []).map(row => [String(row.reading_date).slice(0, 10), row]));
}

function initTrendChart() {
    const canvas = document.getElementById('wasteChart');
    if (!canvas) return;

    wasteChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    type: 'line',
                    label: 'Average peak fill',
                    data: [],
                    borderColor: '#48742c',
                    backgroundColor: '#48742c',
                    yAxisID: 'fill',
                    spanGaps: false,
                    tension: 0.3
                },
                {
                    type: 'bar',
                    label: 'Bins that reached full',
                    data: [],
                    backgroundColor: '#b97523',
                    yAxisID: 'full'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { boxWidth: 16, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label({ dataset, raw }) {
                            return dataset.yAxisID === 'fill'
                                ? `Average peak fill: ${raw}%`
                                : `Bins that reached full: ${raw}`;
                        },
                        footer(items) {
                            const count = wasteChart.reportingBins[items[0].dataIndex];
                            return count == null ? '' : `${count} bins reported`;
                        }
                    }
                }
            },
            scales: {
                fill: {
                    position: 'left',
                    beginAtZero: true,
                    max: 100,
                    ticks: { callback: value => `${value}%` }
                },
                full: {
                    position: 'right',
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    grid: { drawOnChartArea: false }
                },
                x: { ticks: { maxTicksLimit: 8 } }
            }
        }
    });
}

async function refreshTrend() {
    if (!wasteChart) return;

    const requestId = ++trendRequestId;
    const period = document.getElementById('trendPeriod')?.value || 'this-week';
    const { start, end, days } = getTrendPeriod(period);
    setTrendStatus('Loading recorded bin trends…');

    try {
        const readings = await loadBinTrend(start, end);
        if (requestId !== trendRequestId) return;

        renderTrend(days, readings);
        setTrendStatus(readings.size ? '' : 'No recorded sensor readings for this period.');
    } catch (error) {
        if (requestId !== trendRequestId) return;

        console.error('Unable to load LGU trend:', error);
        renderTrend(days, new Map());
        setTrendStatus('Unable to load the trend. Check Supabase permissions and confirm the LGU trend migration is deployed.');
    }
}

function scheduleTrendRefresh() {
    clearTimeout(trendRefreshTimer);
    trendRefreshTimer = setTimeout(refreshTrend, 500);
}

function renderTrend(days, readings) {
    wasteChart.data.labels = days.map(day => chartDate.format(new Date(`${day}T00:00:00Z`)));
    wasteChart.data.datasets[0].data = days.map(day => {
        const value = readings.get(day)?.average_peak;
        return value == null ? null : Number(value);
    });
    wasteChart.data.datasets[1].data = days.map(day => {
        const value = readings.get(day)?.full_bins;
        return value == null ? null : Number(value);
    });
    wasteChart.reportingBins = days.map(day => readings.get(day)?.reporting_bins ?? null);
    wasteChart.update('none');
}

function setTrendStatus(message) {
    const status = document.getElementById('wasteChartStatus');
    if (!status) return;

    status.textContent = message;
    status.hidden = !message;
}
