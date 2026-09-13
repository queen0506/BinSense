import { supabase } from '../supabase-init.js';
const logsDisplay = document.getElementById('logs-display');

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

function syncLogs(filter = 'all') {
    const loadLogs = async () => {
        const { data, error } = await supabase.from('system_logs').select('*').order('timestamp', { ascending: false }).limit(50);
        if (error) {
            console.error('Log sync error:', error);
            logsDisplay.innerHTML = '<p style="text-align:center; color:red;">Access Denied. Ensure you are logged in.</p>';
            return;
        }
        const fragment = document.createDocumentFragment();
        if (!data) {
            logsDisplay.innerHTML = '<p style="text-align:center; color:#999; padding-top:40px;">No logs recorded.</p>';
            return;
        }
        data.forEach(log => {
            if (filter !== 'all' && log.category !== filter) return;
            const isAudit = log.category === 'audit';
            const card = document.createElement('div');
            card.className = `log-card ${isAudit ? 'audit-border' : ''}`;
            const actionText = log.action ? log.action.toUpperCase() : "ACTIVITY";
            const userIdentifier = log.email || log.user || "System";
            const roleBadge = log.role ? `<span class="log-role-badge">${log.role}</span>` : "";
            card.innerHTML = `
                <div class="log-header">
                    <span class="log-user">${userIdentifier} ${roleBadge}</span>
                    <span class="log-category-tag ${log.category || 'logs'}">${log.category || 'LOGS'}</span>
                </div>
                <div class="log-body">
                    <strong style="color: #333;">${actionText}:</strong> 
                    <span class="log-msg">${log.message || 'No details.'}</span>
                </div>
                <div class="log-footer">
                    <span>${formatLogTime(log.timestamp)}</span>
                    <span>${log.timestamp ? new Date(log.timestamp).toLocaleDateString() : ""}</span>
                </div>`;
            fragment.appendChild(card);
        });
        logsDisplay.innerHTML = '';
        logsDisplay.appendChild(fragment);
    };
    loadLogs();
}

window.switchTab = function(e, type) {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    if (e && e.currentTarget) e.currentTarget.classList.add('active');
    logsDisplay.style.opacity = '0.5';
    setTimeout(() => { syncLogs(type); logsDisplay.style.opacity = '1'; }, 100);
};

// CRITICAL: Only sync logs after authentication is confirmed
supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    if (user) {
        syncLogs();
    } else {
        logsDisplay.innerHTML = '<p style="text-align:center; padding-top:40px;">Authenticating...</p>';
    }
});

supabase.channel('system-logs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'system_logs' }, () => syncLogs())
    .subscribe();