import { supabase } from '../supabase-init.js';

let activeRoleName = null;

// --- VIEW NAVIGATION ---[cite: 4]
window.showRolesView = function() {
    document.getElementById('roles-view').style.display = 'block';
    document.getElementById('users-view').style.display = 'none';
    document.getElementById('page-title').textContent = 'User Access Control';
    document.getElementById('back-button').style.display = 'none'; // Hide back button on main view
};

// --- USER LOADING ---[cite: 4]
window.loadUsersByRole = async function(roleName) {
    const container = document.getElementById('users-list-container');
    document.getElementById('roles-view').style.display = 'none';
    document.getElementById('users-view').style.display = 'block';
    document.getElementById('page-title').textContent = roleName;
    document.getElementById('back-button').style.display = 'flex'; // Show back button
    
    container.innerHTML = `<p style="text-align:center; padding-top:20px; color:#999;">Fetching ${roleName}s...</p>`;

    activeRoleName = roleName;
    const { data, error } = await supabase.from('users').select('*').ilike('role', roleName);
    if (error) {
        console.error('User sync failed:', error);
        container.innerHTML = '<p style="text-align:center; color:#c33;">Unable to load users.</p>';
        return;
    }
    container.innerHTML = '';
    (data || []).forEach(user => {
        const card = document.createElement('div');
        card.className = `white-card selectable ${user.is_disabled ? 'user-disabled' : ''}`;
        card.onclick = () => openPermissionModal(user.id, user);
        card.innerHTML = `
            <div class="user-info">
                <span class="user-name">${user.name || 'User'}</span>
                <small style="display:block; color:#777;">${user.email}</small>
            </div>
            <span class="arrow">›</span>
        `;
        container.appendChild(card);
    });
};

// --- MODAL LOGIC (DISABLE/ENABLE) ---[cite: 6]
window.openPermissionModal = function(userId, userData) {
    const modal = document.getElementById('permission-modal');
    const disableBtn = document.getElementById('disable-toggle-btn');
    
    document.getElementById('modal-user-name').textContent = userData.name;
    document.getElementById('modal-user-email').textContent = userData.email;
    document.getElementById('modal-role-badge').textContent = userData.role || "Resident";

    if (userData.is_disabled) {
        disableBtn.textContent = "Enable";
        disableBtn.classList.add('active-state');
    } else {
        disableBtn.textContent = "Disable";
        disableBtn.classList.remove('active-state');
    }

    disableBtn.onclick = async () => {
        const newStatus = !userData.is_disabled;
        const { error } = await supabase.from('users').update({ is_disabled: newStatus }).eq('id', userId);
        if (error) return alert('Unable to update user access.');
        closeModal();
        if (activeRoleName) window.loadUsersByRole(activeRoleName);
    };

    modal.style.display = 'block';
};

window.closeModal = () => document.getElementById('permission-modal').style.display = 'none';

window.exportSystemData = async function() {
    const exportStatus = document.getElementById('export-status');
    const timestampDisplay = document.getElementById('backup-timestamp');
    try {
        const tableNames = ['users', 'bins', 'user_connected_bins', 'bin_history', 'system_logs', 'notifications', 'active_dispatch', 'collection_logs', 'reports', 'feedbacks', 'incident_reports'];
        const results = await Promise.all(tableNames.map(table => supabase.from(table).select('*')));
        const failedResult = results.find(result => result.error);
        if (failedResult) throw failedResult.error;
        const data = Object.fromEntries(tableNames.map((table, index) => [table, results[index].data || []]));
        if (Object.values(data).some(rows => rows.length)) {
            const fileName = `BinSense_Backup_${new Date().toISOString().slice(0,10)}.json`;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            const ts = new Date().toLocaleString();
            if (timestampDisplay) timestampDisplay.innerText = `Last backup: ${ts}`;
            if (exportStatus) {
                exportStatus.style.display = "block";
                setTimeout(() => exportStatus.style.display = "none", 5000);
            }
            localStorage.setItem("BinSense_Last_Export_TS", ts);
        }
    } catch (error) {
        console.error("Export failed:", error);
    }
};

window.restoreSystemData = function() {
    const fileInput = document.getElementById('restore-file-input');
    if (!fileInput || !fileInput.files.length) return;
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!confirm("Overwriting cloud data. Continue?")) return;
            const allowedTables = ['users', 'bins', 'user_connected_bins', 'bin_history', 'system_logs', 'notifications', 'active_dispatch', 'collection_logs', 'reports', 'feedbacks', 'incident_reports'];
            for (const table of allowedTables) {
                if (!Array.isArray(importedData[table]) || importedData[table].length === 0) continue;
                const { error } = await supabase.from(table).upsert(importedData[table]);
                if (error) throw error;
            }
            location.reload(); 
        } catch (error) {
            alert("Invalid backup format.");
        }
    };
    reader.readAsText(file);
};

document.addEventListener('DOMContentLoaded', () => {
    const lastExport = localStorage.getItem("BinSense_Last_Export_TS");
    const timestampDisplay = document.getElementById('backup-timestamp');
    if (lastExport && timestampDisplay) {
        timestampDisplay.innerText = `Last backup: ${lastExport}`;
    }
});

supabase.channel('system-users')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        if (activeRoleName) window.loadUsersByRole(activeRoleName);
    })
    .subscribe();