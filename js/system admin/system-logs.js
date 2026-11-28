import { supabase } from '../supabase-init.js';

const logsDisplay = document.getElementById('logs-display');
const searchInput = document.getElementById('logSearchInput');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');
const filterTabs = document.querySelectorAll('.filter-tab');
const tableHeaders = document.querySelectorAll('th.sortable');
const mobileSortSelect = document.getElementById('mobileSortSelect');

// State Management
let state = {
    page: 1,
    pageSize: 10,
    filter: 'all',
    search: '',
    sortColumn: 'timestamp',
    sortAscending: false,
    totalCount: 0
};

let searchTimeout;

function formatLogTime(timestamp) {
    if (!timestamp) return "Unknown time";
    const date = new Date(timestamp);
    if (isNaN(date)) return "Unknown time";
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    if (diffInSeconds < 60) return "Just now";
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function loadLogs() {
    logsDisplay.style.opacity = '0.5';
    
    // Build Query
    let query = supabase
        .from('system_logs')
        .select('*', { count: 'exact' });

    // Filter
    if (state.filter !== 'all') {
        query = query.eq('category', state.filter);
    }

    // Search
    if (state.search) {
        const term = `%${state.search}%`;
        query = query.or(`email.ilike.${term},action.ilike.${term},message.ilike.${term},role.ilike.${term}`);
    }

    // Sort & Pagination
    const from = (state.page - 1) * state.pageSize;
    const to = from + state.pageSize - 1;

    query = query
        .order(state.sortColumn, { ascending: state.sortAscending })
        .range(from, to);

    // Execute
    const { data, count, error } = await query;

    logsDisplay.style.opacity = '1';

    if (error) {
        console.error('Log sync error:', error);
        logsDisplay.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red; padding: 40px 0;">Access Denied or Network Error.</td></tr>';
        return;
    }

    // Update Pagination State
    state.totalCount = count || 0;
    updatePaginationUI();

    if (!data || data.length === 0) {
        logsDisplay.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--lgu-muted); padding: 40px 0;">No logs found.</td></tr>';
        return;
    }

    // Render Rows
    const fragment = document.createDocumentFragment();
    data.forEach(log => {
        const tr = document.createElement('tr');
        const actionText = log.action ? log.action.toUpperCase() : "ACTIVITY";
        const userIdentifier = log.email || log.user || "System";
        const role = log.role || "N/A";
        const category = log.category || "logs";
        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleDateString() : "";
        
        tr.innerHTML = `
            <td class="col-time">
                <span class="time-main">${formatLogTime(log.timestamp)}</span>
                <span class="time-sub">${dateStr}</span>
            </td>
            <td class="col-user">${userIdentifier}</td>
            <td><span class="role-badge">${role}</span></td>
            <td><span class="category-badge ${category}">${category}</span></td>
            <td class="col-action">${actionText}</td>
            <td class="col-message">${log.message || 'No details.'}</td>
        `;
        fragment.appendChild(tr);
    });
    
    logsDisplay.innerHTML = '';
    logsDisplay.appendChild(fragment);
}

// Update UI Functions
function updatePaginationUI() {
    const totalPages = Math.ceil(state.totalCount / state.pageSize) || 1;
    pageInfo.textContent = `Page ${state.page} of ${totalPages}`;
    prevPageBtn.disabled = state.page === 1;
    nextPageBtn.disabled = state.page >= totalPages;
}

function updateSortIcons() {
    tableHeaders.forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === state.sortColumn) {
            th.classList.add(state.sortAscending ? 'sort-asc' : 'sort-desc');
        }
    });
}

// Event Listeners
prevPageBtn.addEventListener('click', () => {
    if (state.page > 1) {
        state.page--;
        loadLogs();
    }
});

nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(state.totalCount / state.pageSize);
    if (state.page < totalPages) {
        state.page++;
        loadLogs();
    }
});

searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        state.search = e.target.value.trim();
        state.page = 1; // Reset to page 1 on new search
        loadLogs();
    }, 400); // 400ms debounce
});

filterTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        e.preventDefault(); 
        filterTabs.forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        state.filter = e.currentTarget.dataset.filter;
        state.page = 1; 
        loadLogs();
    });
});

tableHeaders.forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (state.sortColumn === col) {
            state.sortAscending = !state.sortAscending;
        } else {
            state.sortColumn = col;
            state.sortAscending = true; 
        }
        state.page = 1;
        updateSortIcons();
        
        // Sync sa mobile dropdown kapag clinick ang desktop header
        if (mobileSortSelect) {
            mobileSortSelect.value = `${state.sortColumn}-${state.sortAscending ? 'asc' : 'desc'}`;
        }
        
        loadLogs();
    });
});

// BAGONG LISTENER PARA SA MOBILE DROPDOWN
if (mobileSortSelect) {
    mobileSortSelect.addEventListener('change', (e) => {
        const [col, dir] = e.target.value.split('-');
        state.sortColumn = col;
        state.sortAscending = (dir === 'asc');
        state.page = 1;
        updateSortIcons(); // I-update din ang desktop arrows kung sakali
        loadLogs();
    });
}


// Initialization
updateSortIcons(); // Set default arrow

// Auth and Realtime
supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
        loadLogs();
    } else {
        logsDisplay.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:40px 0;">Authenticating...</td></tr>';
    }
});

supabase.channel('system-logs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'system_logs' }, () => {
        // Refresh the current page when a new log comes in
        loadLogs(); 
    })
    .subscribe();