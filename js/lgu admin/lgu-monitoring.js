import { supabase } from '../supabase-init.js';

let allBins = [];

// Removed: initNotificationListener function[cite: 11]

async function writeLog(action, message) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
        await supabase.from('system_logs').insert({
            email: user.email,
            action,
            message,
            timestamp: new Date().toISOString()
        });
    } catch (err) { console.error("Log error:", err); }
}

document.addEventListener('DOMContentLoaded', () => {
    const brgySelector = document.getElementById('brgySelector');
    
    // Removed: initNotificationListener call[cite: 11]
    
    const refreshBins = async () => {
        const { data, error } = await supabase.from('bins').select('*');
        if (error) return console.error('Bin sync failed:', error);
        allBins = data || [];
        updateDashboard();
    };
    refreshBins();
    supabase.channel('lgu-monitoring-bins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, refreshBins)
        .subscribe();

    if (brgySelector) {
        brgySelector.addEventListener('change', updateDashboard);
    }

    const scheduleList = document.getElementById('lguScheduleList');
    const scheduleModal = document.getElementById('collectionScheduleModal');
    const scheduleForm = document.getElementById('collectionScheduleForm');
    const scheduleModalTitle = document.getElementById('scheduleModalTitle');
    const saveScheduleBtn = document.getElementById('saveScheduleBtn');
    let editingScheduleId = null;

    const closeScheduleModal = () => {
        scheduleModal.classList.remove('open');
        scheduleForm.reset();
        editingScheduleId = null;
        scheduleModalTitle.textContent = 'Add Collection Schedule';
        saveScheduleBtn.textContent = 'Save Schedule';
    };

    const openScheduleModal = (schedule = null) => {
        editingScheduleId = schedule?.id ?? null;
        scheduleForm.reset();
        if (schedule) {
            document.getElementById('scheduleBarangay').value = schedule.barangay || '';
            document.getElementById('scheduleDate').value = schedule.date || '';
            document.getElementById('scheduleTime').value = schedule.time || '';
            document.getElementById('scheduleType').value = schedule.scheduleType || 'One-Time';
            scheduleModalTitle.textContent = 'Edit Collection Schedule';
            saveScheduleBtn.textContent = 'Update Schedule';
        } else {
            scheduleModalTitle.textContent = 'Add Collection Schedule';
            saveScheduleBtn.textContent = 'Save Schedule';
        }
        scheduleModal.classList.add('open');
    };

    const loadCollectionSchedules = async () => {
        const { data, error } = await supabase.from('notifications')
            .select('*')
            .eq('type', 'collection');

        if (error) {
            console.error('Collection schedule load failed:', error);
            scheduleList.innerHTML = '<p class="schedule-empty">Unable to load collection schedules.</p>';
            return;
        }

        scheduleList.innerHTML = '';
        if (!data?.length) {
            scheduleList.innerHTML = '<p class="schedule-empty">No collection schedules have been added.</p>';
            return;
        }

        const scheduledTimestamp = schedule => {
            const timestamp = Date.parse(`${schedule.date || ''}T${schedule.time || '00:00:00'}Z`);
            return Number.isNaN(timestamp) ? null : timestamp;
        };
        [...data].sort((a, b) => {
            const aTimestamp = scheduledTimestamp(a);
            const bTimestamp = scheduledTimestamp(b);
            if (aTimestamp === null) return bTimestamp === null ? 0 : 1;
            if (bTimestamp === null) return -1;
            return bTimestamp - aTimestamp;
        }).forEach(schedule => {
            const item = document.createElement('article');
            item.className = 'lgu-schedule-item';
            const details = document.createElement('div');
            details.className = 'lgu-schedule-details';
            const area = document.createElement('h4');
            area.textContent = `Brgy. ${schedule.barangay || 'Unassigned'}`;
            const dateTime = document.createElement('p');
            const displayDate = schedule.date
                ? new Date(`${schedule.date}T00:00:00`).toLocaleDateString()
                : 'Date not set';
            dateTime.textContent = `${displayDate} at ${schedule.time || 'Time not set'}`;
            details.append(area, dateTime);

            const type = document.createElement('span');
            type.className = 'lgu-schedule-type';
            type.textContent = schedule.scheduleType || 'One-Time';

            const status = document.createElement('span');
            status.className = `lgu-schedule-status ${schedule.collection_status === 'Done' ? 'is-done' : 'is-scheduled'}`;
            status.textContent = schedule.collection_status === 'Done' ? 'Done' : 'Scheduled';

            const actions = document.createElement('div');
            actions.className = 'schedule-item-actions';
            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.textContent = 'Edit';
            editButton.addEventListener('click', () => openScheduleModal(schedule));
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'schedule-delete-btn';
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', async () => {
                if (!window.confirm(`Delete the collection schedule for ${schedule.barangay}?`)) return;
                try {
                    const { data: deletedSchedule, error: deleteError } = await supabase.from('notifications')
                        .delete()
                        .eq('id', schedule.id)
                        .eq('type', 'collection')
                        .select('id')
                        .maybeSingle();
                    if (deleteError) throw deleteError;
                    if (!deletedSchedule) {
                        console.error('Collection schedule delete failed: no matching schedule was deleted.', schedule.id);
                        window.alert('Unable to delete this schedule. Please try again.');
                        return;
                    }
                    await loadCollectionSchedules();
                } catch (deleteError) {
                    console.error('Collection schedule delete failed:', deleteError);
                    window.alert('Unable to delete this schedule. Please try again.');
                }
            });
            actions.append(editButton, deleteButton);
            item.append(details, type, status, actions);
            scheduleList.appendChild(item);
        });
    };

    document.getElementById('addCollectionSchedule').addEventListener('click', () => openScheduleModal());
    document.getElementById('closeScheduleModal').addEventListener('click', closeScheduleModal);
    document.getElementById('cancelScheduleEdit').addEventListener('click', closeScheduleModal);
    scheduleModal.addEventListener('click', event => {
        if (event.target === scheduleModal) closeScheduleModal();
    });

    scheduleForm.addEventListener('submit', async event => {
        event.preventDefault();
        saveScheduleBtn.disabled = true;
        saveScheduleBtn.textContent = editingScheduleId ? 'Updating...' : 'Saving...';

        const barangay = document.getElementById('scheduleBarangay').value.trim();
        const date = document.getElementById('scheduleDate').value;
        const time = document.getElementById('scheduleTime').value;
        const scheduleType = document.getElementById('scheduleType').value;
        const values = {
            title: 'Waste Collection Schedule',
            message: `Waste collection in Brgy. ${barangay} on ${date} at ${time} (${scheduleType})`,
            barangay,
            date,
            time,
            scheduleType,
            type: 'collection',
            status: 'unread'
        };

        const query = editingScheduleId
            ? supabase.from('notifications').update(values).eq('id', editingScheduleId)
            : supabase.from('notifications').insert({ ...values, created_at: new Date().toISOString() });
        const { error } = await query;
        saveScheduleBtn.disabled = false;

        if (error) {
            console.error('Collection schedule save failed:', error);
            saveScheduleBtn.textContent = editingScheduleId ? 'Update Schedule' : 'Save Schedule';
            window.alert('Unable to save this schedule. Please try again.');
            return;
        }

        closeScheduleModal();
        await loadCollectionSchedules();
    });

    loadCollectionSchedules();
    supabase.channel('lgu-collection-schedules')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'type=eq.collection' }, loadCollectionSchedules)
        .subscribe();
});

function updateDashboard() {
    const selector = document.getElementById('brgySelector');
    if (!selector) return;

    const selectedBrgy = selector.value;
    const filtered = selectedBrgy === 'all' ? allBins : allBins.filter(b => b.barangay === selectedBrgy);

    document.getElementById('count-available').innerText = filtered.filter(b => b.status?.toLowerCase() === 'available').length;
    document.getElementById('count-filling').innerText = filtered.filter(b => b.status?.toLowerCase() === 'filling').length;
    document.getElementById('count-full').innerText = filtered.filter(b => b.status?.toLowerCase() === 'full').length;

    updateHotspots();
}

function updateHotspots() {
    const hotspotContainer = document.getElementById('hotspotContainer');
    if (!hotspotContainer) return;

    const ranking = {};

    allBins.filter(b => b.status?.toLowerCase() === 'full').forEach(b => {
        ranking[b.barangay] = (ranking[b.barangay] || 0) + 1;
    });

    const sorted = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 3);

    if (sorted.length > 0) {
        hotspotContainer.innerHTML = sorted.map(([brgy, count]) => `
            <div class="hotspot-item">
                <div class="hotspot-text-group">
                    <span class="hotspot-brgy">${brgy}</span>
                    <span class="hotspot-count">${count} Bins overflowing</span>
                </div>
                <div class="alert-badge">URGENT</div>
            </div>
        `).join('');
    } else {
        hotspotContainer.innerHTML = `<div class="no-hotspots"><p>All clear.</p></div>`;
    }
}

window.openDetails = (status) => {
    const modal = document.getElementById('detailsModal');
    const container = document.getElementById('binCardsContainer');
    const selector = document.getElementById('brgySelector');
    if (!selector || !modal || !container) return;

    const selectedBrgy = selector.value;
    const matches = allBins.filter(b => b.status?.toLowerCase() === status && (selectedBrgy === 'all' || b.barangay === selectedBrgy));

    document.getElementById('modalTitle').innerText = `${status.toUpperCase()} Bins`;
    container.innerHTML = matches.map(b => `
        <div class="bin-id-card">
            <h4>Smart Bin ID: ${b.id.replace('bin_', '')}</h4>
            <p>Barangay: ${b.barangay}</p>
        </div>
    `).join('');
    modal.style.display = "flex";
};

window.closeModal = () => {
    const modal = document.getElementById('detailsModal');
    if (modal) modal.style.display = "none";
};