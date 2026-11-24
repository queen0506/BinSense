import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let wasteChart;
let trendRequestId = 0;
let trendRefreshTimer;
let currentFilter = 'all';
let collectionCsvAvailable = false;
let collectionCsvExporting = false;

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
    collectionCsvAvailable = available;
    const button = document.getElementById('exportCollectionCsvBtn');
    if (button) button.disabled = !available || collectionCsvExporting;
}

function escapeCsvField(value) {
    let text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function formatBinId(value) {
    const binId = String(value || '').trim();
    if (!binId) return 'Unassigned';
    return binId.startsWith('bin_')
        ? `Bin #${binId.slice(4)}`
        : `Bin #${binId}`;
}

function normalizeBinId(value) {
    return String(value || '').trim().replace(/^bin_/i, '');
}

function getBinAddress(record, addresses) {
    const candidates = [
        record.bin_id,
        normalizeBinId(record.bin_id),
        `bin_${normalizeBinId(record.bin_id)}`
    ];

    for (const candidate of candidates) {
        const address = addresses.get(candidate);
        if (address && address !== 'Location not assigned') return address;
    }
    return 'Location not assigned';
}

async function loadBinAddresses(records) {
    const ids = [...new Set(records
        .map(record => record.bin_id)
        .filter(value => typeof value === 'string' && value.trim()))];
    const lookupIds = [...new Set(ids.flatMap(binId => [
        binId,
        normalizeBinId(binId),
        `bin_${normalizeBinId(binId)}`
    ].filter(Boolean)))];
    const addresses = new Map();

    if (!lookupIds.length) return addresses;

    try {
        const { data, error } = await supabase.rpc('get_lgu_collection_log_bin_addresses', {
            p_bin_ids: lookupIds
        });
        if (!error) {
            (data || []).forEach(row => {
                if (!row?.bin_id || !row?.location_label?.trim()) return;
                addresses.set(row.bin_id, row.location_label.trim());
                addresses.set(normalizeBinId(row.bin_id), row.location_label.trim());
                addresses.set(`bin_${normalizeBinId(row.bin_id)}`, row.location_label.trim());
            });
        } else {
            console.warn('Unable to load collection-log addresses through the secure RPC:', error);
        }
    } catch (addressError) {
        console.warn('Unable to load collection-log addresses through the secure RPC:', addressError);
    }

    const { data: bins, error: binError } = await supabase
        .from('bins')
        .select('id, street, barangay')
        .in('id', lookupIds);
    if (binError) {
        console.warn('Unable to load bin installation addresses:', binError);
    }

    (bins || []).forEach(bin => {
        const addressParts = [bin.street, bin.barangay]
            .map(value => String(value || '').trim())
            .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));
        if (!addressParts.length) return;

        const label = addressParts.join(', ');
        if (addresses.has(bin.id) ||
            addresses.has(normalizeBinId(bin.id)) ||
            addresses.has(`bin_${normalizeBinId(bin.id)}`)) return;

        addresses.set(bin.id, label);
        addresses.set(normalizeBinId(bin.id), label);
        addresses.set(`bin_${normalizeBinId(bin.id)}`, label);
    });

    const { data: connections, error: connectionError } = await supabase
        .from('user_connected_bins')
        .select('bin_id, user_id')
        .in('bin_id', lookupIds);
    if (connectionError) {
        console.warn('Unable to load bin citizen connections:', connectionError);
        return addresses;
    }

    const userIdsByBin = new Map();
    (connections || []).forEach(connection => {
        if (!connection?.bin_id || !connection?.user_id) return;
        const userIds = userIdsByBin.get(connection.bin_id) || [];
        userIds.push(connection.user_id);
        userIdsByBin.set(connection.bin_id, userIds);
    });

    const uniqueConnections = [];
    userIdsByBin.forEach((userIds, binId) => {
        if (new Set(userIds).size !== 1) return;
        uniqueConnections.push({ binId, userId: userIds[0] });
    });

    if (!uniqueConnections.length) return addresses;

    const userIds = [...new Set(uniqueConnections.map(connection => connection.userId))];
    const { data: profiles, error: profileError } = await supabase
        .from('users')
        .select('id, role, address_confirmed, house_number, street_name, barangay, city_municipality, province')
        .in('id', userIds);
    if (profileError) {
        console.warn('Unable to load confirmed citizen addresses:', profileError);
        return addresses;
    }

    const profilesById = new Map((profiles || []).map(profile => [profile.id, profile]));
    uniqueConnections.forEach(({ binId, userId }) => {
        const profile = profilesById.get(userId);
        if (String(profile?.role || '').trim().toLowerCase() !== 'citizen' ||
            profile.address_confirmed !== true) return;

        const houseAndStreet = [profile.house_number, profile.street_name]
            .map(value => String(value || '').trim())
            .filter(Boolean)
            .join(' ');
        const parts = [
            houseAndStreet,
            profile.barangay,
            profile.city_municipality,
            profile.province
        ].map(value => String(value || '').trim())
            .filter(value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value));
        if (!parts.length) return;

        const label = parts.join(', ');
        addresses.set(binId, label);
        addresses.set(normalizeBinId(binId), label);
        addresses.set(`bin_${normalizeBinId(binId)}`, label);
    });

    return addresses;
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

function getCollectionStartDate(filterType) {
    if (filterType === 'all') return null;

    const now = new Date();
    if (filterType === 'today') {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    }
    if (filterType === 'week') {
        const firstDay = new Date(now);
        firstDay.setDate(firstDay.getDate() - firstDay.getDay());
        firstDay.setHours(0, 0, 0, 0);
        return firstDay.toISOString();
    }
    if (filterType === 'month') {
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    }
    return null;
}

async function fetchAllCollectionRecords(filterType) {
    const batchSize = 1000;
    const records = [];
    let offset = 0;
    const startDate = getCollectionStartDate(filterType);

    while (true) {
        const { data, error } = await supabase.rpc('get_lgu_collection_log', {
            p_start: startDate,
            p_limit: batchSize,
            p_offset: offset
        });
        if (error) throw error;
        if (!data?.length) break;

        records.push(...data);
        offset += data.length;
        if (data.length < batchSize) break;
    }

    return records;
}

async function exportCollectionCsv() {
    if (collectionCsvExporting) return;

    collectionCsvExporting = true;
    setCollectionCsvAvailability(collectionCsvAvailable);
    try {
        const filterType = currentFilter;
        const records = await fetchAllCollectionRecords(filterType);
        if (records.length === 0) {
            alert('No collection records to export.');
            return;
        }

        const addresses = new Map();
        for (let index = 0; index < records.length; index += 150) {
            const batchAddresses = await loadBinAddresses(records.slice(index, index + 150));
            batchAddresses.forEach((address, binId) => addresses.set(binId, address));
        }

        const headers = ['Bin ID', 'Bin Address', 'Date & Time', 'Actual Collector', 'Registered To'];
        const rows = records.map(record => {
            const date = new Date(record.collected_at);
            const dateTime = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
            return [
                formatBinId(record.bin_id),
                getBinAddress(record, addresses),
                dateTime,
                record.actual_collector_name,
                record.registered_to
            ].map(escapeCsvField).join(',');
        });

        const csvContent = '\uFEFF' + [
            headers.map(escapeCsvField).join(','),
            ...rows
        ].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        const timeframe = getCollectionTimeframe(filterType);
        link.download = `BinSense_CollectionLog_${timeframe}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('Collection CSV export failed:', error);
        alert('CSV export failed. Please try again.');
    } finally {
        collectionCsvExporting = false;
        setCollectionCsvAvailability(collectionCsvAvailable);
    }
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
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888; padding: 20px;">Loading records...</td></tr>';

        const from = (currentPage - 1) * pageSize;
        const startDate = getCollectionStartDate(dateFilter);

        const { data, error } = await supabase.rpc('get_lgu_collection_log', {
            p_start: startDate,
            p_limit: pageSize,
            p_offset: from
        });
        if (error) {
            console.error('Failed to load records:', error);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ff4444;">Failed to load records.</td></tr>';
            return;
        }

        totalRecords = Number(data?.[0]?.total_count) || 0;
        updatePaginationUI();

        if (!data?.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888; padding: 20px;">No collection records found.</td></tr>';
            return;
        }

        let addresses;
        try {
            addresses = await loadBinAddresses(data);
        } catch (addressError) {
            console.error('Failed to load bin addresses:', addressError);
            addresses = new Map();
        }

        tbody.innerHTML = data.map(rec => {
            const dateObj = new Date(rec.collected_at);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            return `
                <tr>
                    <td data-label="Bin ID" class="bin-id-cell" style="font-weight: 700;">${escapeHtml(formatBinId(rec.bin_id))}</td>
                    <td data-label="Bin Address" class="bin-address-cell">${escapeHtml(getBinAddress(rec, addresses))}</td>
                    <td data-label="Date & Time">${dateStr} <br><span style="color:#888; font-size:0.75rem;">${timeStr}</span></td>
                    <td data-label="Actual Collector"><span class="actual-name">${escapeHtml(rec.actual_collector_name)}</span></td>
                    <td data-label="Registered To"><span class="registered-name">${escapeHtml(rec.registered_to)}</span></td>
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_logs' }, loadCollectionRecords)
        .subscribe();
});

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

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