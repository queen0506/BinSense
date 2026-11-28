import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let wasteChart;
let trendRequestId = 0;
let trendRefreshTimer;
let currentFilter = 'all';
let collectionXlsxAvailable = false;
let collectionXlsxExporting = false;

const manilaDate = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});
const manilaDateTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
});
const collectionDate = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
});
const collectionTime = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h12'
});
const chartDate = new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
});

initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

function setCollectionXlsxAvailability(available) {
    collectionXlsxAvailable = available;
    const button = document.getElementById('exportCollectionXlsxBtn');
    if (button) button.disabled = !available || collectionXlsxExporting;
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

function getManilaParts(date) {
    return Object.fromEntries(manilaDate.formatToParts(date).map(({ type, value }) => [type, value]));
}

function getPhilippineDateStamp(date = new Date()) {
    const parts = getManilaParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function toPhilippineExcelDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const parts = Object.fromEntries(manilaDateTime.formatToParts(date).map(({ type, value: partValue }) => [type, partValue]));
    return new Date(Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
    ));
}

function formatPhilippineDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: 'Date unavailable', time: '' };
    return {
        date: collectionDate.format(date),
        time: collectionTime.format(date)
    };
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

    const parts = getManilaParts(new Date());
    const calendarDay = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
    if (filterType === 'today') return new Date(calendarDay.getTime() - 8 * 60 * 60 * 1000).toISOString();

    if (filterType === 'week') {
        const mondayOffset = (calendarDay.getUTCDay() + 6) % 7;
        calendarDay.setUTCDate(calendarDay.getUTCDate() - mondayOffset);
        return new Date(calendarDay.getTime() - 8 * 60 * 60 * 1000).toISOString();
    }
    if (filterType === 'month') {
        calendarDay.setUTCDate(1);
        return new Date(calendarDay.getTime() - 8 * 60 * 60 * 1000).toISOString();
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

async function exportCollectionXlsx() {
    if (collectionXlsxExporting) return;
    if (!window.ExcelJS?.Workbook) {
        console.error('Collection XLSX export failed: ExcelJS is unavailable.');
        alert('Excel export is unavailable. Check your internet connection and try again.');
        return;
    }

    collectionXlsxExporting = true;
    setCollectionXlsxAvailability(collectionXlsxAvailable);
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

        const generatedAt = new Date();
        const workbook = new window.ExcelJS.Workbook();
        workbook.creator = 'BinSense';
        workbook.created = generatedAt;
        workbook.modified = generatedAt;
        workbook.title = 'BinSense LGU Collection Log';
        workbook.subject = `Collection log - ${getCollectionTimeframe(filterType)}`;
        workbook.company = 'BinSense';
        workbook.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0 }];
        const collectionLog = workbook.addWorksheet('Collection Log', {
            properties: { tabColor: { argb: 'FF99CC33' } },
            views: [{ state: 'frozen', ySplit: 4 }]
        });

        const summary = workbook.addWorksheet('Report Summary', {
            properties: { tabColor: { argb: 'FF48742C' } }
        });
        summary.columns = [
            { width: 28 },
            { width: 24 },
            { width: 24 },
            { width: 32 }
        ];
        summary.mergeCells('A1:D1');
        summary.getCell('A1').value = 'BINSENSE LGU COLLECTION REPORT';
        summary.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
        summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF48742C' } };
        summary.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
        summary.getRow(1).height = 36;

        summary.mergeCells('A2:D2');
        summary.getCell('A2').value = 'Waste Collection Log';
        summary.getCell('A2').font = { name: 'Aptos', size: 11, italic: true, color: { argb: 'FF64705F' } };
        summary.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
        summary.getRow(2).height = 22;

        summary.getCell('A4').value = 'Report Period';
        summary.getCell('B4').value = getCollectionTimeframe(filterType);
        summary.getCell('C4').value = 'Generated';
        summary.getCell('D4').value = toPhilippineExcelDate(generatedAt);
        summary.getCell('D4').numFmt = 'mmm d, yyyy h:mm AM/PM';
        summary.getCell('A5').value = 'Record Type';
        summary.getCell('B5').value = 'Waste Collection';
        summary.getCell('C5').value = 'Total Records';
        summary.getCell('D5').value = records.length;
        summary.getRow(4).height = 22;
        summary.getRow(5).height = 24;
        ['A4', 'C4', 'A5', 'C5'].forEach(address => {
            const cell = summary.getCell(address);
            cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF33432C' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1E5' } };
        });
        ['B4', 'D4', 'B5', 'D5'].forEach(address => {
            const cell = summary.getCell(address);
            cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF333333' } };
            cell.alignment = { vertical: 'middle' };
        });
        summary.getCell('D5').font = { name: 'Aptos', size: 14, bold: true, color: { argb: 'FF48742C' } };
        summary.getCell('D5').alignment = { horizontal: 'center', vertical: 'middle' };

        summary.views = [{ state: 'frozen', ySplit: 3 }];
        summary.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

        collectionLog.columns = [
            { key: 'binId', width: 18 },
            { key: 'address', width: 42 },
            { key: 'collectedAt', width: 30 },
            { key: 'collector', width: 26 },
            { key: 'registeredTo', width: 26 }
        ];
        collectionLog.mergeCells('A1:E1');
        collectionLog.getCell('A1').value = 'COLLECTION LOG DETAILS';
        collectionLog.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
        collectionLog.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF48742C' } };
        collectionLog.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
        collectionLog.getRow(1).height = 32;
        collectionLog.mergeCells('A2:E2');
        collectionLog.getCell('A2').value = `${records.length} records | ${getCollectionTimeframe(filterType)}`;
        collectionLog.getCell('A2').font = { name: 'Aptos', size: 10, italic: true, color: { argb: 'FF64705F' } };
        collectionLog.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
        collectionLog.getRow(2).height = 22;
        collectionLog.getRow(4).values = ['Bin ID', 'Bin Address', 'Date & Time', 'Actual Collector', 'Registered To'];
        collectionLog.getRow(4).height = 24;
        collectionLog.getRow(4).eachCell(cell => {
            cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF71934E' } };
            cell.alignment = { vertical: 'middle', wrapText: true };
            cell.border = { bottom: { style: 'medium', color: { argb: 'FF48742C' } } };
        });

        const sortedRecords = [...records].sort((first, second) =>
            new Date(second.collected_at) - new Date(first.collected_at)
        );
        sortedRecords.forEach((record, index) => {
            const row = collectionLog.addRow({
                binId: formatBinId(record.bin_id),
                address: getBinAddress(record, addresses),
                collectedAt: toPhilippineExcelDate(record.collected_at) || 'Date unavailable',
                collector: record.actual_collector_name || 'Not recorded',
                registeredTo: record.registered_to || 'Not recorded'
            });
            row.height = 30;
            row.eachCell((cell, columnNumber) => {
                cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF333333' } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: index % 2 === 0 ? 'FFF7F9F5' : 'FFFFFFFF' }
                };
                cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE4D7' } } };
                cell.alignment = {
                    vertical: 'middle',
                    wrapText: columnNumber !== 3
                };
                if (columnNumber === 3 && cell.value instanceof Date) {
                    cell.numFmt = 'mmm d, yyyy h:mm AM/PM';
                }
            });
        });
        if (collectionLog.rowCount !== records.length + 4) {
            throw new Error(`Expected ${records.length} collection rows, but only prepared ${collectionLog.rowCount - 4}.`);
        }
        collectionLog.autoFilter = { from: 'A4', to: `E${collectionLog.rowCount}` };
        collectionLog.pageSetup = {
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            paperSize: 9,
            printTitlesRow: '4:4'
        };

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        const timeframe = getCollectionTimeframe(filterType);
        link.download = `BinSense_CollectionLog_${timeframe}_${getPhilippineDateStamp()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('Collection XLSX export failed:', error);
        alert('Excel export failed. Please try again.');
    } finally {
        collectionXlsxExporting = false;
        setCollectionXlsxAvailability(collectionXlsxAvailable);
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
        setCollectionXlsxAvailability(false);
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
            const dateTime = formatPhilippineDateTime(rec.collected_at);

            return `
                <tr>
                    <td data-label="Bin ID" class="bin-id-cell" style="font-weight: 700;">${escapeHtml(formatBinId(rec.bin_id))}</td>
                    <td data-label="Bin Address" class="bin-address-cell">${escapeHtml(getBinAddress(rec, addresses))}</td>
                    <td data-label="Date & Time">${escapeHtml(dateTime.date)} <br><span style="color:#888; font-size:0.75rem;">${escapeHtml(dateTime.time)}</span></td>
                    <td data-label="Actual Collector"><span class="actual-name">${escapeHtml(rec.actual_collector_name)}</span></td>
                    <td data-label="Registered To"><span class="registered-name">${escapeHtml(rec.registered_to)}</span></td>
                </tr>
            `;
        }).join('');

        setCollectionXlsxAvailability(true);
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

    document.getElementById('exportCollectionXlsxBtn')?.addEventListener('click', exportCollectionXlsx);

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