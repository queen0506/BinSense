import { supabase } from '../supabase-init.js';
import { EAST_BAJAC_BAJAC } from '../citizen-address.js';

let allLogs = []; 
let filteredLogs = []; 
let myChart = null;
let currentFilter = 'daily'; 
const PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 25;
let currentPage = 1;
const manilaDateTimeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
});
const reportDateFormatter = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
});
const reportTimeFormatter = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h12'
});
const chartHourFormatter = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    hour: 'numeric'
});
const chartWeekdayFormatter = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    weekday: 'short'
});
const chartMonthFormatter = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    month: 'short',
    year: '2-digit'
});

document.addEventListener('DOMContentLoaded', () => {
    const filterDropdown = document.getElementById('timeFilter');

    if (filterDropdown) {
        filterDropdown.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            currentPage = 1;
            applyFilter(currentFilter);
        });
    }

    document.getElementById('exportXlsxBtn')?.addEventListener('click', exportXLSX);
    document.getElementById('exportPdfBtn')?.addEventListener('click', exportPDF);
    document.getElementById('reportPrevPage')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable();
        }
    });
    document.getElementById('reportNextPage')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredLogs.length / TABLE_PAGE_SIZE);
        if (currentPage < totalPages) {
            currentPage++;
            renderTable();
        }
    });

    supabase.channel('report-logs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_logs' }, () => {
            fetchAllData(); 
        })
        .subscribe();

    let chartResizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(chartResizeTimer);
        chartResizeTimer = setTimeout(() => {
            if (myChart) myChart.resize();
        }, 150);
    });

    fetchAllData();
});

async function fetchAllData() {
    const reportBody = document.getElementById('reportBody');
    reportBody.innerHTML = `<tr><td colspan="4" class="loading-text">Loading collection records...</td></tr>`;
    document.getElementById('reportPageInfo').textContent = 'Loading records';
    document.getElementById('reportPrevPage').disabled = true;
    document.getElementById('reportNextPage').disabled = true;
    setExportAvailability(false);

    try {
        const logs = [];
        let from = 0;

        while (true) {
            const { data, error } = await supabase
                .from('collection_logs')
                .select('*')
                .order('collected_at', { ascending: false })
                .range(from, from + PAGE_SIZE - 1);

            if (error) throw error;
            if (!data?.length) break;

            logs.push(...data);
            if (data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }

        allLogs = logs;
    } catch (error) {
        console.error('Error fetching logs:', error);
        allLogs = [];
        filteredLogs = [];
        updateUI();
        reportBody.innerHTML = `<tr><td colspan="4" class="loading-text">Unable to load report data. Please try again.</td></tr>`;
        document.getElementById('reportPageInfo').textContent = 'Records unavailable';
        return;
    }

    applyFilter(currentFilter); 
}

function applyFilter(filterType) {
    const now = new Date();
    const todayKey = getManilaDateKey(now);
    const todayMidnight = new Date(`${todayKey}T00:00:00Z`);

    filteredLogs = allLogs.filter(log => {
        const logDateObj = new Date(log.collected_at);
        if (Number.isNaN(logDateObj.getTime())) return false;
        const logDateKey = getManilaDateKey(logDateObj);

        if (filterType === 'daily') {
            return logDateKey === todayKey;
        } else if (filterType === 'weekly') {
            const weekStart = new Date(todayMidnight);
            const mondayIndex = (todayMidnight.getUTCDay() + 6) % 7;
            weekStart.setUTCDate(weekStart.getUTCDate() - mondayIndex);
            return logDateKey >= weekStart.toISOString().slice(0, 10) && logDateKey <= todayKey;
        } else if (filterType === 'monthly') {
            return logDateKey.slice(0, 7) === todayKey.slice(0, 7);
        } else if (filterType === 'all') {
            return true;
        }

        return false;
    });

    updateUI();
}

function updateUI() {
    let completed = 0, pending = 0, missed = 0;
    
    filteredLogs.forEach(log => {
        const action = normalizeAction(log.action);
        if (action === 'Completed') completed++;
        else if (action === 'Pending') pending++;
        else if (action === 'Missed') missed++;
    });

    document.getElementById('totalCollections').textContent = filteredLogs.length;
    document.getElementById('completedCollections').textContent = completed;
    document.getElementById('pendingCollections').textContent = pending;
    document.getElementById('missedCollections').textContent = missed;

    setExportAvailability(filteredLogs.length > 0);
    renderTable();
    renderChart(filteredLogs);
}

function setExportAvailability(available) {
    const xlsxButton = document.getElementById('exportXlsxBtn');
    const pdfButton = document.getElementById('exportPdfBtn');
    if (xlsxButton) xlsxButton.disabled = !available;
    if (pdfButton) pdfButton.disabled = !available;
}

function renderTable() {
    const tableBody = document.getElementById('reportBody');
    if (filteredLogs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="loading-text">No collection records found.</td></tr>`;
        currentPage = 1;
        document.getElementById('reportPageInfo').textContent = 'No records';
        document.getElementById('reportPrevPage').disabled = true;
        document.getElementById('reportNextPage').disabled = true;
    } else {
        const totalPages = Math.ceil(filteredLogs.length / TABLE_PAGE_SIZE);
        currentPage = Math.min(currentPage, totalPages);
        const startIndex = (currentPage - 1) * TABLE_PAGE_SIZE;
        const pageLogs = filteredLogs.slice(startIndex, startIndex + TABLE_PAGE_SIZE);

        tableBody.innerHTML = pageLogs.map(log => {
            const dateStr = formatDate(log.collected_at);
            const binIdStr = formatBinId(log.bin_id);
            const action = normalizeAction(log.action);
            let statusColor = '#4CAF50';
            if (action === 'Pending') statusColor = '#FFC107';
            if (action === 'Missed') statusColor = '#F44336';

            return `<tr>
                <td>${escapeHtml(dateStr)}</td>
                <td>${escapeHtml(formatBarangay(log.barangay))}</td>
                <td>${escapeHtml(binIdStr)}</td>
                <td><span style="color: ${statusColor}; font-weight: bold;">${escapeHtml(action)}</span></td>
            </tr>`;
        }).join('');

        document.getElementById('reportPageInfo').textContent =
            `Showing ${startIndex + 1}-${Math.min(startIndex + pageLogs.length, filteredLogs.length)} of ${filteredLogs.length}`;
        document.getElementById('reportPrevPage').disabled = currentPage === 1;
        document.getElementById('reportNextPage').disabled = currentPage === totalPages;
    }
}

function renderChart(logs) {
    const canvas = document.getElementById('collectionsChart');
    if (typeof Chart !== 'function' || !canvas) {
        console.error('Unable to render report chart: Chart.js is unavailable.');
        return;
    }

    const ctx = canvas.getContext('2d');
    if (myChart) myChart.destroy();

    const buckets = getChartBuckets(currentFilter, logs);
    const bucketIndices = new Map(buckets.map((bucket, index) => [bucket.key, index]));
    const counts = {
        Completed: Array(buckets.length).fill(0),
        Pending: Array(buckets.length).fill(0),
        Missed: Array(buckets.length).fill(0)
    };

    logs.forEach(log => {
        const date = toPhilippineWallClockDate(log.collected_at);
        if (!date) return;

        const action = normalizeAction(log.action);
        if (!Object.prototype.hasOwnProperty.call(counts, action)) return;

        const key = getLogBucketKey(currentFilter, date, buckets);
        const bucketIndex = bucketIndices.get(key);
        if (bucketIndex !== undefined) counts[action][bucketIndex]++;
    });

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: buckets.map(bucket => bucket.label),
            datasets: [
                { label: 'Collected', data: counts.Completed, backgroundColor: '#4CAF50', borderRadius: 4 },
                { label: 'For Collection', data: counts.Pending, backgroundColor: '#FFC107', borderRadius: 4 },
                { label: 'Uncollected', data: counts.Missed, backgroundColor: '#F44336', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: window.innerWidth < 600 ? 2 : 8,
                    right: window.innerWidth < 600 ? 2 : 8,
                    bottom: window.innerWidth < 600 ? 4 : 8
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 10,
                        boxHeight: 10,
                        padding: 12,
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        font: { size: 11 }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } },
                x: {
                    grid: { display: false },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: window.innerWidth < 600 ? 5 : 10,
                        maxRotation: window.innerWidth < 600 ? 45 : 0,
                        minRotation: 0,
                        padding: 4,
                        font: { size: window.innerWidth < 600 ? 9 : 11 }
                    }
                }
            }
        }
    });
}

function createPdfChartImage(logs) {
    if (typeof Chart !== 'function') return null;

    const chartCanvas = document.createElement('canvas');
    chartCanvas.width = 720;
    chartCanvas.height = 300;
    chartCanvas.style.width = '720px';
    chartCanvas.style.height = '300px';
    chartCanvas.style.position = 'fixed';
    chartCanvas.style.left = '-10000px';
    chartCanvas.style.top = '0';
    document.body.appendChild(chartCanvas);

    const buckets = getChartBuckets(currentFilter, logs);
    const bucketIndices = new Map(buckets.map((bucket, index) => [bucket.key, index]));
    const counts = {
        Completed: Array(buckets.length).fill(0),
        Pending: Array(buckets.length).fill(0),
        Missed: Array(buckets.length).fill(0)
    };

    logs.forEach(log => {
        const date = toPhilippineWallClockDate(log.collected_at);
        if (!date) return;

        const action = normalizeAction(log.action);
        if (!Object.prototype.hasOwnProperty.call(counts, action)) return;

        const bucketIndex = bucketIndices.get(getLogBucketKey(currentFilter, date, buckets));
        if (bucketIndex !== undefined) counts[action][bucketIndex]++;
    });

    const pdfChart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
            labels: buckets.map(bucket => bucket.label),
            datasets: [
                { label: 'Collected', data: counts.Completed, backgroundColor: '#4CAF50', borderRadius: 4 },
                { label: 'For Collection', data: counts.Pending, backgroundColor: '#FFC107', borderRadius: 4 },
                { label: 'Uncollected', data: counts.Missed, backgroundColor: '#F44336', borderRadius: 4 }
            ]
        },
        options: {
            responsive: false,
            animation: false,
            maintainAspectRatio: false,
            layout: { padding: { top: 8, right: 12, bottom: 4, left: 12 } },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        boxHeight: 12,
                        padding: 16,
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        font: { family: 'Arial', size: 12 }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, font: { family: 'Arial', size: 11 } },
                    grid: { color: '#dfe5dc' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        minRotation: 0,
                        font: { family: 'Arial', size: 11 }
                    }
                }
            }
        }
    });

    pdfChart.update('none');
    const image = chartCanvas.toDataURL('image/png', 1);
    pdfChart.destroy();
    chartCanvas.remove();
    return image;
}

function normalizeAction(action) {
    const value = String(action || '').trim().toLowerCase();
    if (value.includes('completed')) return 'Completed';
    if (value.includes('pending')) return 'Pending';
    if (value.includes('missed')) return 'Missed';
    return String(action || 'Unknown').trim() || 'Unknown';
}

function formatDate(value, includeTime = false) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    if (!includeTime) return reportDateFormatter.format(date);

    const datePart = reportDateFormatter.format(date);
    const timePart = reportTimeFormatter.format(date);
    return `${datePart} ${timePart}`;
}

function formatBinId(value) {
    const text = String(value || '').trim();
    if (!text) return 'Unknown';
    return text.startsWith('bin_') ? `Bin #${text.replace(/^bin_/, '')}` : `Bin #${text}`;
}

function formatBarangay(value) {
    const barangay = String(value || '').trim();
    return !barangay || /^(unknown|global|unassigned|n\/a|not specified)$/i.test(barangay)
        ? EAST_BAJAC_BAJAC
        : barangay;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getPhilippineDateStamp(date = new Date()) {
    return getManilaDateKey(date);
}

function toPhilippineWallClockDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    const parts = Object.fromEntries(manilaDateTimeParts.formatToParts(date)
        .map(({ type, value: partValue }) => [type, partValue]));
    return new Date(Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
    ));
}

function getStatusCounts(logs) {
    const counts = { Completed: 0, Pending: 0, Missed: 0 };
    logs.forEach(log => {
        const action = normalizeAction(log.action);
        if (Object.prototype.hasOwnProperty.call(counts, action)) counts[action]++;
    });
    return counts;
}

function getFilterLabel(filterType) {
    const labels = {
        daily: 'Today',
        weekly: 'This Week',
        monthly: 'This Month',
        all: 'All Time'
    };
    return labels[filterType] || filterType;
}

function getChartBuckets(filterType, logs) {
    const now = toPhilippineWallClockDate(new Date());
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    if (filterType === 'daily') {
        return [0, 4, 8, 12, 16, 20].map(hour => {
            const start = new Date(today);
            start.setUTCHours(hour, 0, 0, 0);
            const end = new Date(start);
            end.setUTCHours(hour + 4, 0, 0, 0);
            return { start, end, key: String(hour), label: chartHourFormatter.format(start) };
        });
    }

    if (filterType === 'weekly') {
        const mondayIndex = (today.getUTCDay() + 6) % 7;
        const start = new Date(today);
        start.setUTCDate(start.getUTCDate() - mondayIndex);
        return Array.from({ length: 7 }, (_, index) => {
            const bucketStart = new Date(start);
            bucketStart.setUTCDate(start.getUTCDate() + index);
            const bucketEnd = new Date(bucketStart);
            bucketEnd.setUTCDate(bucketStart.getUTCDate() + 1);
            return {
                start: bucketStart,
                end: bucketEnd,
                key: getDateKey(bucketStart),
                label: chartWeekdayFormatter.format(bucketStart)
            };
        });
    }

    if (filterType === 'monthly') {
        const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
        return Array.from({ length: daysInMonth }, (_, index) => {
            const bucketStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 1));
            const bucketEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 2));
            return {
                start: bucketStart,
                end: bucketEnd,
                key: getDateKey(bucketStart),
                label: String(index + 1)
            };
        });
    }

    const dates = logs
        .map(log => toPhilippineWallClockDate(log.collected_at))
        .filter(Boolean);
    const earliest = dates.length
        ? dates.reduce((first, date) => date < first ? date : first)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
    const latest = dates.length
        ? dates.reduce((last, date) => date > last ? date : last, now)
        : now;
    const monthSpan = (latest.getUTCFullYear() - earliest.getUTCFullYear()) * 12 +
        latest.getUTCMonth() - earliest.getUTCMonth() + 1;

    if (monthSpan > 36) {
        const firstYear = earliest.getUTCFullYear();
        const lastYear = latest.getUTCFullYear();
        return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
            const year = firstYear + index;
            const bucketStart = new Date(Date.UTC(year, 0, 1));
            const bucketEnd = new Date(Date.UTC(year + 1, 0, 1));
            return {
                start: bucketStart,
                end: bucketEnd,
                key: String(year),
                interval: 'year',
                label: String(year)
            };
        });
    }

    const firstMonth = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
    return Array.from({ length: monthSpan }, (_, index) => {
        const bucketStart = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1));
        const bucketEnd = new Date(Date.UTC(bucketStart.getUTCFullYear(), bucketStart.getUTCMonth() + 1, 1));
        return {
            start: bucketStart,
            end: bucketEnd,
            key: getMonthKey(bucketStart),
            interval: 'month',
            label: chartMonthFormatter.format(bucketStart)
        };
    });
}

function getLogBucketKey(filterType, date, buckets) {
    if (filterType === 'daily') return String(Math.floor(date.getUTCHours() / 4) * 4);
    if (filterType === 'weekly' || filterType === 'monthly') return getDateKey(date);
    if (buckets[0]?.interval === 'year') return String(date.getUTCFullYear());
    return getMonthKey(date);
}

function getDateKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getMonthKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getManilaDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function getPeakFillDateRange(filterType) {
    const today = new Date(`${getManilaDateKey()}T00:00:00Z`);
    const addUtcDays = (date, days) => {
        const next = new Date(date);
        next.setUTCDate(next.getUTCDate() + days);
        return next.toISOString().slice(0, 10);
    };

    if (filterType === 'daily') {
        return { start: today.toISOString().slice(0, 10), end: addUtcDays(today, 1) };
    }

    if (filterType === 'weekly') {
        const mondayOffset = (today.getUTCDay() + 6) % 7;
        const monday = new Date(today);
        monday.setUTCDate(monday.getUTCDate() - mondayOffset);
        return { start: monday.toISOString().slice(0, 10), end: addUtcDays(today, 1) };
    }

    if (filterType === 'monthly') {
        const firstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
        const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
        return {
            start: firstDay.toISOString().slice(0, 10),
            end: nextMonth.toISOString().slice(0, 10)
        };
    }

    return { start: null, end: null };
}

async function getAveragePeakFill(filterType) {
    const { start, end } = getPeakFillDateRange(filterType);
    const peakLevels = [];
    let from = 0;

    while (true) {
        let query = supabase
            .from('daily_bin_peaks')
            .select('peak_level');

        if (start) query = query.gte('reading_date', start);
        if (end) query = query.lt('reading_date', end);

        const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data?.length) break;

        peakLevels.push(...data
            .map(row => Number(row.peak_level))
            .filter(value => Number.isFinite(value) && value >= 0 && value <= 100));

        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    if (!peakLevels.length) return null;
    const average = peakLevels.reduce((sum, value) => sum + value, 0) / peakLevels.length;
    return Math.round(average);
}

async function exportXLSX() {
    if (filteredLogs.length === 0) return;

    const ExcelJS = window.ExcelJS;
    if (!ExcelJS?.Workbook) {
        console.error('Excel export failed: ExcelJS is unavailable.');
        alert('Excel export is unavailable. Check your internet connection and try again.');
        return;
    }

    const button = document.getElementById('exportXlsxBtn');
    button.disabled = true;
    button.textContent = 'Preparing...';
    button.setAttribute('aria-busy', 'true');

    try {
        const counts = getStatusCounts(filteredLogs);
        const generatedAt = new Date();
        const generatedAtPhilippine = toPhilippineWallClockDate(generatedAt);
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'BinSense';
        workbook.created = generatedAt;
        workbook.modified = generatedAt;
        workbook.subject = `Collection report - ${getFilterLabel(currentFilter)}`;
        workbook.title = 'BinSense Collection Report';
        workbook.company = 'BinSense';

        const summary = workbook.addWorksheet('Report Summary', {
            properties: { tabColor: { argb: 'FF48742C' } }
        });
        summary.columns = [
            { width: 30 },
            { width: 18 },
            { width: 22 },
            { width: 28 }
        ];
        summary.mergeCells('A1:D1');
        summary.getCell('A1').value = 'BINSENSE COLLECTION REPORT';
        summary.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
        summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF48742C' } };
        summary.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
        summary.getRow(1).height = 36;

        summary.mergeCells('A2:D2');
        summary.getCell('A2').value = 'Waste Collection Record';
        summary.getCell('A2').font = { name: 'Aptos', size: 11, color: { argb: 'FF64705F' }, italic: true };
        summary.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
        summary.getRow(2).height = 22;

        summary.getCell('A4').value = 'Report Period';
        summary.getCell('B4').value = getFilterLabel(currentFilter);
        summary.getCell('C4').value = 'Generated';
        summary.getCell('D4').value = generatedAtPhilippine;
        summary.getCell('D4').numFmt = 'mmm d, yyyy h:mm AM/PM';
        summary.getCell('A5').value = 'Record Type';
        summary.getCell('B5').value = 'Waste Collection';
        summary.getCell('C5').value = 'Total Records';
        summary.getCell('D5').value = filteredLogs.length;

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
        summary.getCell('D5').font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FF48742C' } };

        summary.mergeCells('A7:C7');
        summary.getCell('A7').value = 'COLLECTION SUMMARY';
        summary.getCell('A7').font = { name: 'Aptos', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
        summary.getCell('A7').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF48742C' } };
        summary.getCell('A7').alignment = { vertical: 'middle' };
        summary.getRow(7).height = 24;
        summary.getRow(8).values = ['Metric', 'Count', '% of Total'];

        const summaryHeader = summary.getRow(8);
        summaryHeader.height = 22;
        summaryHeader.eachCell(cell => {
            cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF71934E' } };
            cell.alignment = { vertical: 'middle' };
        });

        const summaryRows = [
            ['All Collection Records', filteredLogs.length],
            ['Collected', counts.Completed],
            ['For Collection', counts.Pending],
            ['Uncollected', counts.Missed]
        ];
        summaryRows.forEach(([label, count], index) => {
            const row = summary.addRow([label, count, filteredLogs.length ? count / filteredLogs.length : 0]);
            row.height = 21;
            row.eachCell(cell => {
                cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF333333' } };
                cell.border = { bottom: { style: 'thin', color: { argb: 'FFDCE4D7' } } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: index % 2 === 0 ? 'FFF7F9F5' : 'FFFFFFFF' }
                };
                cell.alignment = { vertical: 'middle' };
            });
            row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(3).numFmt = '0.0%';
            row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
            if (index === 0) row.getCell(2).font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF48742C' } };
        });

        summary.views = [{ state: 'frozen', ySplit: 8 }];
        summary.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

        const activity = workbook.addWorksheet('Collection Activity', {
            properties: { tabColor: { argb: 'FF99CC33' } },
            views: [{ state: 'frozen', ySplit: 4 }]
        });
        activity.columns = [
            { key: 'dateTime', width: 24 },
            { key: 'barangay', width: 30 },
            { key: 'binId', width: 20 },
            { key: 'status', width: 22 }
        ];
        activity.mergeCells('A1:D1');
        activity.getCell('A1').value = 'COLLECTION ACTIVITY DETAILS';
        activity.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
        activity.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF48742C' } };
        activity.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
        activity.getRow(1).height = 32;
        activity.mergeCells('A2:D2');
        activity.getCell('A2').value = `${getFilterLabel(currentFilter)} - ${filteredLogs.length} records`;
        activity.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF64705F' }, italic: true };
        activity.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
        activity.getRow(2).height = 22;
        activity.getRow(4).values = ['Date & Time', 'Barangay', 'Bin ID', 'Status'];
        activity.pageSetup = {
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            paperSize: 9
        };
        activity.pageSetup.printTitlesRow = '4:4';

        activity.getRow(4).height = 24;
        activity.getRow(4).eachCell(cell => {
            cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF71934E' } };
            cell.alignment = { vertical: 'middle' };
            cell.border = { bottom: { style: 'medium', color: { argb: 'FF48742C' } } };
        });

        const sortedLogs = [...filteredLogs].sort((first, second) =>
            new Date(second.collected_at) - new Date(first.collected_at)
        );
        sortedLogs.forEach((log, index) => {
            const row = activity.addRow([
                toPhilippineWallClockDate(log.collected_at) || 'Date unavailable',
                formatBarangay(log.barangay),
                formatBinId(log.bin_id),
                normalizeAction(log.action)
            ]);
            row.height = 21;
            row.eachCell((cell, columnNumber) => {
                cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF333333' } };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: index % 2 === 0 ? 'FFF7F9F5' : 'FFFFFFFF' }
                };
                cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE4D7' } } };
                cell.alignment = { vertical: 'middle' };
                if (columnNumber === 1 && cell.value instanceof Date) {
                    cell.numFmt = 'mmm d, yyyy h:mm AM/PM';
                }
            });

            const statusCell = row.getCell(4);
            const statusStyles = {
                Completed: { font: 'FF2E7D32', fill: 'FFE8F5E9' },
                Pending: { font: 'FF9A6B00', fill: 'FFFFF4D6' },
                Missed: { font: 'FFC62828', fill: 'FFFFEBEE' }
            };
            const style = statusStyles[normalizeAction(log.action)];
            if (style) {
                statusCell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: style.font } };
                statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
            }
        });
        activity.autoFilter = { from: 'A4', to: `D${activity.rowCount}` };

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timeframe = currentFilter === 'all'
            ? 'AllTime'
            : currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1);
        link.download = `BinSense_Collection_Report_${timeframe}_${getPhilippineDateStamp()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('Excel export failed:', error);
        alert('Excel export failed. Please try again.');
    } finally {
        button.textContent = 'EXCEL';
        button.removeAttribute('aria-busy');
        setExportAvailability(filteredLogs.length > 0);
    }
}

async function exportPDF() {
    if (!window.jspdf?.jsPDF) {
        console.error('PDF export failed: jsPDF is unavailable.');
        alert('PDF export is unavailable. Check your internet connection and try again.');
        return;
    }

    let adminName = 'System Administrator';

    try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        const user = authData?.user;

        if (!authError && user) {
            const { data: profile, error: profileError } = await supabase
                .from('users')
                .select('name')
                .eq('id', user.id)
                .maybeSingle();

            if (!profileError && profile?.name?.trim()) {
                adminName = profile.name.trim();
            } else if (user.email) {
                adminName = user.email;
            }
        }
    } catch (error) {
        console.error('Unable to resolve the logged-in System Admin:', error);
    }

    const pdfAdminName = document.getElementById('pdf-admin-name');
    if (pdfAdminName) pdfAdminName.textContent = adminName;

    if (filteredLogs.length === 0) return alert("No data to export.");
    const button = document.getElementById('exportPdfBtn');
    const element = document.getElementById('pdf-template');
    if (!element) {
        console.error('PDF export failed: the PDF template was not found.');
        alert('PDF export failed. Please reload the report page and try again.');
        return;
    }
    button.disabled = true;
    button.textContent = 'Preparing...';
    button.setAttribute('aria-busy', 'true');

    try {
        document.getElementById('pdf-generated-date').textContent = new Date().toLocaleString('en-PH', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h12'
        });
        document.getElementById('pdf-filter-type').textContent = getFilterLabel(currentFilter);

        const counts = getStatusCounts(filteredLogs);
        document.getElementById('pdf-total').textContent = filteredLogs.length;
        document.getElementById('pdf-completed').textContent = counts.Completed;
        document.getElementById('pdf-pending').textContent = counts.Pending;
        document.getElementById('pdf-missed').textContent = counts.Missed;

        try {
            const averagePeakFill = await getAveragePeakFill(currentFilter);
            document.getElementById('pdf-average-peak').textContent =
                averagePeakFill === null ? 'N/A' : `${averagePeakFill}%`;
        } catch (error) {
            console.error('Unable to load average peak fill:', error);
            document.getElementById('pdf-average-peak').textContent = 'N/A';
        }

        const pdfChartImage = document.getElementById('pdf-chart-image');
        if (pdfChartImage) {
            const pdfChartSource = createPdfChartImage(filteredLogs);
            if (pdfChartSource) pdfChartImage.src = pdfChartSource;
        }

        const pdfRecordNote = document.getElementById('pdf-record-note');
        const recordsForPdf = [...filteredLogs]
            .sort((first, second) => new Date(second.collected_at) - new Date(first.collected_at))
            .slice(0, 10);

        if (pdfRecordNote) {
            pdfRecordNote.textContent = filteredLogs.length > 10
                ? `Latest ${recordsForPdf.length} of ${filteredLogs.length} records shown. Download EXCEL for the complete report.`
                : `${recordsForPdf.length} records included in this report period.`;
        }

        const pdfTableBody = document.getElementById('pdf-table-body');
        pdfTableBody.innerHTML = recordsForPdf.map(log => {
            const dateTime = formatDate(log.collected_at, true);
            const binId = formatBinId(log.bin_id);
            const action = normalizeAction(log.action);

            return `<tr style="break-inside: avoid; page-break-inside: avoid;">
                <td style="border: 1px solid #000; padding: 5px 6px;">${escapeHtml(dateTime)}</td>
                <td style="border: 1px solid #000; padding: 5px 6px;">${escapeHtml(formatBarangay(log.barangay))}</td>
                <td style="border: 1px solid #000; padding: 5px 6px;">${escapeHtml(binId)}</td>
                <td style="border: 1px solid #000; padding: 5px 6px;">${escapeHtml(action)}</td>
            </tr>`;
        }).join('');

        const isMobileExport = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches ||
            window.navigator.userAgentData?.mobile === true;
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            unit: 'mm',
            format: 'a4',
            orientation: isMobileExport ? 'landscape' : 'portrait',
            compress: true
        });
        pdf.setProperties({
            title: 'BinSense Collection Report',
            subject: `Collection report - ${getFilterLabel(currentFilter)}`,
            author: adminName,
            creator: 'BinSense'
        });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        let y = 18;

        const drawPageFooter = (pageNumber, totalPages) => {
            pdf.setDrawColor(210);
            pdf.setLineWidth(0.2);
            pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8);
            pdf.setTextColor(110);
            pdf.text('BinSense Collection Report', margin, pageHeight - 7);
            pdf.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
            pdf.setTextColor(0);
        };

        const drawPageHeader = (sectionTitle) => {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(13);
            pdf.setTextColor(40);
            pdf.text(sectionTitle, margin, 15);
            pdf.setDrawColor(180);
            pdf.setLineWidth(0.25);
            pdf.line(margin, 18, pageWidth - margin, 18);
            pdf.setTextColor(0);
        };

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(20);
        pdf.text('BINSENSE COLLECTION REPORT', pageWidth / 2, y, { align: 'center' });
        y += 7;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.text('Waste Collection Record', pageWidth / 2, y, { align: 'center' });
        y += 5;
        pdf.setLineWidth(0.6);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 8;

        pdf.setFontSize(10);
        pdf.text(`Report Date: ${new Date().toLocaleString('en-PH', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h12'
        })}`, margin, y);
        pdf.text(`Report Period: ${getFilterLabel(currentFilter)}`, pageWidth - margin, y, { align: 'right' });
        y += 5;
        pdf.text(`Prepared By: ${adminName}`, margin, y);
        pdf.text('Record Type: Waste Collection', pageWidth - margin, y, { align: 'right' });
        y += 10;

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.text('Collection Summary', margin, y);
        y += 5;

        const summaryRows = [
            ['All Collection Records', filteredLogs.length],
            ['Collected', counts.Completed],
            ['For Collection', counts.Pending],
            ['Uncollected', counts.Missed],
            ['Average Peak Fill', document.getElementById('pdf-average-peak').textContent]
        ];
        const tableWidth = pageWidth - (margin * 2);
        const rowHeight = 9;
        pdf.setFontSize(9);
        summaryRows.forEach(([label, value], index) => {
            pdf.setFillColor(index % 2 === 0 ? 245 : 255, index % 2 === 0 ? 245 : 255, index % 2 === 0 ? 245 : 255);
            pdf.rect(margin, y, tableWidth, rowHeight, 'FD');
            pdf.setFont('helvetica', 'normal');
            pdf.text(String(label), margin + 3, y + 6);
            pdf.setFont('helvetica', 'bold');
            pdf.text(String(value), pageWidth - margin - 3, y + 6, { align: 'right' });
            y += rowHeight;
        });

        y += 9;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.text('Collections by Period', margin, y);
        y += 5;

        const chartSource = createPdfChartImage(filteredLogs);
        if (chartSource) {
            pdf.addImage(chartSource, 'PNG', margin, y, tableWidth, 70);
            y += 75;
        }

        if (isMobileExport) {
            pdf.addPage();
            y = 18;
            drawPageHeader('Collection Activity Details');
            y = 25;
        }

        if (!isMobileExport) {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            pdf.text('Collection Activity Details', margin, y);
            y += 7;
        }

        if (filteredLogs.length > 10) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(8);
            pdf.setTextColor(90);
            pdf.text(`Latest ${recordsForPdf.length} of ${filteredLogs.length} records shown. Download EXCEL for the complete report.`, margin, y);
            pdf.setTextColor(0);
            y += 6;
        }

        const columnWidths = isMobileExport
            ? [70, 75, 50, 82]
            : [46, 55, 35, 46];
        const headers = ['Date & Time', 'Barangay', 'Bin ID', 'Status'];
        const drawDetailHeader = () => {
            pdf.setFillColor(230, 230, 230);
            pdf.rect(margin, y, tableWidth, 8, 'F');
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(8);
            let x = margin;
            headers.forEach((header, index) => {
                pdf.text(header, x + 2, y + 5.5);
                x += columnWidths[index];
            });
            y += 8;
        };

        drawDetailHeader();
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);

        recordsForPdf.forEach((log, rowIndex) => {
            const rowValues = [
                formatDate(log.collected_at, true),
                formatBarangay(log.barangay),
                formatBinId(log.bin_id),
                normalizeAction(log.action)
            ];

            const wrappedValues = rowValues.map((value, index) =>
                pdf.splitTextToSize(String(value), columnWidths[index] - 4)
            );
            const rowHeight = Math.max(10, ...wrappedValues.map(lines => lines.length * 3.5 + 4));

            if (y + rowHeight > pageHeight - 24) {
                pdf.addPage();
                y = 18;
                drawPageHeader('Collection Activity Details');
                y = 25;
                drawDetailHeader();
            }

            pdf.setFillColor(rowIndex % 2 === 0 ? 255 : 248, rowIndex % 2 === 0 ? 255 : 248, rowIndex % 2 === 0 ? 255 : 248);
            pdf.rect(margin, y, tableWidth, rowHeight, 'FD');

            let x = margin;
            rowValues.forEach((value, index) => {
                if (index === 3) {
                    const status = normalizeAction(value);
                    pdf.setTextColor(
                        status === 'Completed' ? 76 : status === 'Pending' ? 175 : status === 'Missed' ? 244 : 80,
                        status === 'Completed' ? 175 : status === 'Pending' ? 120 : status === 'Missed' ? 67 : 80,
                        status === 'Completed' ? 80 : status === 'Pending' ? 0 : status === 'Missed' ? 54 : 80
                    );
                } else {
                    pdf.setTextColor(30);
                }
                pdf.text(wrappedValues[index], x + 2, y + 4.5, { lineHeightFactor: 1 });
                x += columnWidths[index];
            });
            pdf.setTextColor(0);
            y += rowHeight;
        });

        y += 12;
        if (y + 24 > pageHeight) {
            pdf.addPage();
            y = pageHeight - 30;
        }
        pdf.setFontSize(8);
        pdf.line(margin + 5, y, margin + 70, y);
        pdf.line(pageWidth - margin - 70, y, pageWidth - margin - 5, y);
        pdf.text('Prepared by', margin + 37.5, y + 5, { align: 'center' });
        pdf.text('Checked by', pageWidth - margin - 37.5, y + 5, { align: 'center' });

        const totalPages = pdf.getNumberOfPages();
        for (let page = 1; page <= totalPages; page++) {
            pdf.setPage(page);
            drawPageFooter(page, totalPages);
        }

        const filename = `BinSense_OfficialAudit_${currentFilter === 'all'
            ? 'AllTime'
            : currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1)}_${getPhilippineDateStamp()}.pdf`;
        pdf.save(filename);
    } catch (error) {
        console.error('PDF export failed:', error);
        alert('PDF export failed. Please try again.');
    } finally {
        element.style.display = 'none';
        button.disabled = false;
        button.textContent = 'PDF';
        button.removeAttribute('aria-busy');
    }
}