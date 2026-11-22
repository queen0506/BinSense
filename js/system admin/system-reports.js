import { supabase } from '../supabase-init.js';

let allLogs = []; 
let filteredLogs = []; 
let myChart = null;
let currentFilter = 'daily'; 
const PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 25;
let currentPage = 1;

document.addEventListener('DOMContentLoaded', () => {
    const filterDropdown = document.getElementById('timeFilter');

    if (filterDropdown) {
        filterDropdown.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            currentPage = 1;
            applyFilter(currentFilter);
        });
    }

    document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
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
    // Create a "Today at Midnight" date for comparison
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    filteredLogs = allLogs.filter(log => {
        // Create a "Log Date at Midnight" date
        const logDateObj = new Date(log.collected_at);
        if (Number.isNaN(logDateObj.getTime())) return false;
        const logMidnight = new Date(logDateObj.getFullYear(), logDateObj.getMonth(), logDateObj.getDate());
        
        // 1. DAILY (Exactly the same day)
        if (filterType === 'daily') {
            return logMidnight.getTime() === todayMidnight.getTime();
        } 
        
        // 2. WEEKLY (Current calendar week)
        else if (filterType === 'weekly') {
            const weekStart = new Date(todayMidnight);
            const mondayIndex = (todayMidnight.getDay() + 6) % 7;
            weekStart.setDate(weekStart.getDate() - mondayIndex);

            return logMidnight >= weekStart && logMidnight <= todayMidnight;
        } 
        
        // 3. MONTHLY (Same Month and Year)
        else if (filterType === 'monthly') {
            return logDateObj.getFullYear() === now.getFullYear() &&
                   logDateObj.getMonth() === now.getMonth();
        } 
        
        // 4. ALL TIME
        else if (filterType === 'all') {
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
    const csvButton = document.getElementById('exportCsvBtn');
    const pdfButton = document.getElementById('exportPdfBtn');
    if (csvButton) csvButton.disabled = !available;
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
                <td>${escapeHtml(log.barangay || 'Unknown')}</td>
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
        const date = new Date(log.collected_at);
        if (Number.isNaN(date.getTime())) return;

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
    if (!includeTime) return date.toLocaleDateString();

    const datePart = date.toLocaleDateString();
    const timePart = date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
    return `${datePart} ${timePart}`;
}

function formatBinId(value) {
    const text = String(value || '').trim();
    if (!text) return 'Unknown';
    return text.startsWith('bin_') ? `Bin #${text.replace(/^bin_/, '')}` : `Bin #${text}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function toCsvField(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text.trimStart())) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function getLocalDateStamp(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (filterType === 'daily') {
        return [0, 4, 8, 12, 16, 20].map(hour => {
            const start = new Date(today);
            start.setHours(hour, 0, 0, 0);
            const end = new Date(start);
            end.setHours(hour + 4, 0, 0, 0);
            return { start, end, key: String(hour), label: start.toLocaleTimeString([], { hour: 'numeric' }) };
        });
    }

    if (filterType === 'weekly') {
        const mondayIndex = (today.getDay() + 6) % 7;
        const start = new Date(today);
        start.setDate(start.getDate() - mondayIndex);
        return Array.from({ length: 7 }, (_, index) => {
            const bucketStart = new Date(start);
            bucketStart.setDate(start.getDate() + index);
            const bucketEnd = new Date(bucketStart);
            bucketEnd.setDate(bucketStart.getDate() + 1);
            return {
                start: bucketStart,
                end: bucketEnd,
                key: getDateKey(bucketStart),
                label: bucketStart.toLocaleDateString([], { weekday: 'short' })
            };
        });
    }

    if (filterType === 'monthly') {
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        return Array.from({ length: daysInMonth }, (_, index) => {
            const bucketStart = new Date(now.getFullYear(), now.getMonth(), index + 1);
            const bucketEnd = new Date(now.getFullYear(), now.getMonth(), index + 2);
            return {
                start: bucketStart,
                end: bucketEnd,
                key: getDateKey(bucketStart),
                label: String(index + 1)
            };
        });
    }

    const dates = logs
        .map(log => new Date(log.collected_at))
        .filter(date => !Number.isNaN(date.getTime()));
    const earliest = dates.length
        ? dates.reduce((first, date) => date < first ? date : first)
        : new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const latest = dates.length
        ? dates.reduce((last, date) => date > last ? date : last, now)
        : now;
    const monthSpan = (latest.getFullYear() - earliest.getFullYear()) * 12 +
        latest.getMonth() - earliest.getMonth() + 1;

    if (monthSpan > 36) {
        const firstYear = earliest.getFullYear();
        const lastYear = latest.getFullYear();
        return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => {
            const year = firstYear + index;
            const bucketStart = new Date(year, 0, 1);
            const bucketEnd = new Date(year + 1, 0, 1);
            return {
                start: bucketStart,
                end: bucketEnd,
                key: String(year),
                interval: 'year',
                label: String(year)
            };
        });
    }

    const firstMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    return Array.from({ length: monthSpan }, (_, index) => {
        const bucketStart = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1);
        const bucketEnd = new Date(bucketStart.getFullYear(), bucketStart.getMonth() + 1, 1);
        return {
            start: bucketStart,
            end: bucketEnd,
            key: getMonthKey(bucketStart),
            interval: 'month',
            label: bucketStart.toLocaleDateString([], { month: 'short', year: '2-digit' })
        };
    });
}

function getLogBucketKey(filterType, date, buckets) {
    if (filterType === 'daily') return String(Math.floor(date.getHours() / 4) * 4);
    if (filterType === 'weekly' || filterType === 'monthly') return getDateKey(date);
    if (buckets[0]?.interval === 'year') return String(date.getFullYear());
    return getMonthKey(date);
}

function getDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function exportCSV() {
    if (filteredLogs.length === 0) return;

    const button = document.getElementById('exportCsvBtn');
    let url;
    button.disabled = true;
    button.textContent = 'Preparing...';
    button.setAttribute('aria-busy', 'true');

    try {
        const headers = ["Date & Time", "Barangay", "Bin ID", "Status"];
        const rows = filteredLogs.map(log => {
            const dateTime = formatDate(log.collected_at, true);
            const binId = formatBinId(log.bin_id);
            const action = normalizeAction(log.action);
            return [dateTime, log.barangay || 'Unknown', binId, action].map(toCsvField).join(',');
        });

        const csvContent = '\uFEFF' + [headers.map(toCsvField).join(','), ...rows].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const timeframe = currentFilter === 'all'
            ? 'AllTime'
            : currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1);
        link.download = `BinSense_AuditData_${timeframe}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (error) {
        console.error('CSV export failed:', error);
        alert('CSV export failed. Please try again.');
    } finally {
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
        button.textContent = 'CSV';
        button.removeAttribute('aria-busy');
        setExportAvailability(filteredLogs.length > 0);
    }
}

async function exportPDF() {
    if (typeof html2pdf !== 'function') {
        console.error('PDF export failed: html2pdf is unavailable.');
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
        document.getElementById('pdf-generated-date').textContent = new Date().toLocaleString([], {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        document.getElementById('pdf-filter-type').textContent = getFilterLabel(currentFilter);

        const counts = getStatusCounts(filteredLogs);
        document.getElementById('pdf-total').textContent = filteredLogs.length;
        document.getElementById('pdf-completed').textContent = counts.Completed;
        document.getElementById('pdf-pending').textContent = counts.Pending;
        document.getElementById('pdf-missed').textContent = counts.Missed;

        const pdfTableBody = document.getElementById('pdf-table-body');
        pdfTableBody.innerHTML = filteredLogs.map(log => {
            const dateTime = formatDate(log.collected_at, true);
            const binId = formatBinId(log.bin_id);
            const action = normalizeAction(log.action);

            return `<tr>
                <td style="border: 1px solid #000; padding: 6px;">${escapeHtml(dateTime)}</td>
                <td style="border: 1px solid #000; padding: 6px;">${escapeHtml(log.barangay || 'Unknown')}</td>
                <td style="border: 1px solid #000; padding: 6px;">${escapeHtml(binId)}</td>
                <td style="border: 1px solid #000; padding: 6px;">${escapeHtml(action)}</td>
            </tr>`;
        }).join('');

        element.style.display = 'block';
        const opt = {
            margin: 0,
            filename: `BinSense_OfficialAudit_${currentFilter === 'all'
                ? 'AllTime'
                : currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1)}_${new Date().toISOString().split('T')[0]}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                scrollX: 0,
                scrollY: 0,
                onclone: clonedDocument => {
                    const clonedTemplate = clonedDocument.getElementById('pdf-template');
                    if (!clonedTemplate) throw new Error('PDF template was not cloned.');
                    clonedTemplate.style.position = 'static';
                    clonedTemplate.style.left = 'auto';
                    clonedTemplate.style.top = 'auto';
                    clonedTemplate.style.zIndex = 'auto';
                    clonedTemplate.style.display = 'block';
                }
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        };

        await html2pdf().set(opt).from(element).save();
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