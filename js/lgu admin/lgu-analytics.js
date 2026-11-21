import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let wasteChart;
const ctx = document.getElementById('wasteChart').getContext('2d');

initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

document.addEventListener('DOMContentLoaded', () => {
    initTrendChart();

    const loadBins = async () => {
        setTrendStatus('Loading weekly bin readings...');
        try {
            const { data, error } = await supabase.from('bins').select('*, bin_history(data, counts)');
            if (error) throw error;
            processAnalytics(data || []);
        } catch (error) {
            console.error('Analytics sync failed:', error);
            wasteChart.data.datasets[0].data = [null, null, null, null, null, null, null];
            wasteChart.update('none');
            setTrendStatus('Unable to load waste readings. Check your connection and sign-in, then try again.');
        }
    };

        // PAGINATION & FILTER STATE
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

    loadBins();
    loadCollectionRecords();

    supabase.channel('lgu-analytics-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadBins)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bin_history' }, loadBins)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_records' }, loadCollectionRecords)
        .subscribe();

});

function initTrendChart() {
    wasteChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Average Waste Level (%)',
                data: [null, null, null, null, null, null, null],
                borderColor: '#99cc33',
                backgroundColor: 'rgba(153, 204, 51, 0.05)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { stepSize: 25, font: { size: 10 } } },
                x: { ticks: { font: { size: 10 } } }
            }
        }
    });
}

function processAnalytics(bins) {
    updateTrendGraph(bins);
}

function updateTrendGraph(bins) {
    const weeklyTotals = [0, 0, 0, 0, 0, 0, 0];
    const weeklyCounts = [0, 0, 0, 0, 0, 0, 0];

    bins.forEach(bin => {
        const history = Array.isArray(bin.bin_history) ? bin.bin_history[0] : bin.bin_history;
        if (!history || !Array.isArray(history.data) || !Array.isArray(history.counts)
            || history.data.length !== 7 || history.counts.length !== 7) {
            return;
        }

        history.data.forEach((total, index) => {
            const count = Number(history.counts[index]);
            const value = Number(total);
            if (Number.isFinite(value) && Number.isFinite(count) && count > 0) {
                weeklyTotals[index] += value;
                weeklyCounts[index] += count;
            }
        });
    });

    const hasReadings = weeklyCounts.some(count => count > 0);
    wasteChart.data.datasets[0].data = weeklyTotals.map((total, index) =>
        weeklyCounts[index] > 0 ? Math.round(total / weeklyCounts[index]) : null
    );
    wasteChart.update('none');
    setTrendStatus(hasReadings ? '' : 'No weekly bin readings are available yet.');
}

function setTrendStatus(message) {
    const status = document.getElementById('wasteChartStatus');
    if (!status) return;

    status.textContent = message;
    status.hidden = !message;
}