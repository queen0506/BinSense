import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let allBins = [];
const manilaDateFormatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});
const manilaTimeFormatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
});
const scheduleTimeFormatter = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
});

function getManilaDate(date) {
    const parts = Object.fromEntries(manilaDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatTime(minutes) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
    const minute = String(minutes % 60).padStart(2, '0');
    return `${hour}:${minute}`;
}

function formatScheduleTime(time) {
    if (!time) return 'Time not set';
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    if (!match) return 'Time unavailable';
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    if (hours > 23 || minutes > 59 || seconds > 59) return 'Time unavailable';
    return scheduleTimeFormatter.format(new Date(Date.UTC(
        2000,
        0,
        1,
        hours,
        minutes,
        seconds
    )));
}

// Removed: initNotificationListener function[cite: 11]
initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

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

    const scheduleList = document.getElementById('lguScheduleList');
    const scheduleModal = document.getElementById('collectionScheduleModal');
    const scheduleForm = document.getElementById('collectionScheduleForm');
    const scheduleModalTitle = document.getElementById('scheduleModalTitle');
    const saveScheduleBtn = document.getElementById('saveScheduleBtn');
    const scheduleDateInput = document.getElementById('scheduleDate');
    const scheduleDateError = document.getElementById('scheduleDateError');
    const scheduleTimeInput = document.getElementById('scheduleTime');
    const scheduleTimeError = document.getElementById('scheduleTimeError');
    const officeStartMinutes = 8 * 60;
    const officeEndMinutes = 17 * 60;
    let editingScheduleId = null;

    const updateScheduleConstraints = () => {
        const now = new Date();
        const today = getManilaDate(now);
        const timeParts = Object.fromEntries(manilaTimeFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
        const currentMinutes = Number(timeParts.hour) * 60 + Number(timeParts.minute);
        const earliestToday = Math.max(
            officeStartMinutes,
            currentMinutes + (now.getSeconds() || now.getMilliseconds() ? 1 : 0)
        );
        const isToday = scheduleDateInput.value === today;
        const noSlotsToday = isToday && currentMinutes >= officeEndMinutes;
        const earliestTime = isToday ? Math.min(earliestToday, officeEndMinutes) : officeStartMinutes;

        const dateError = scheduleDateInput.value && scheduleDateInput.value < today
            ? 'Choose today or a future date.'
            : '';
        scheduleDateError.textContent = dateError;
        scheduleDateError.hidden = !dateError;
        scheduleDateInput.setAttribute('aria-invalid', String(Boolean(dateError)));
        scheduleDateInput.setCustomValidity('');

        let timeError = '';
        if (noSlotsToday) {
            timeError = 'No office times remain today; choose another date.';
        } else if (scheduleTimeInput.value && (scheduleTimeInput.value < '08:00' || scheduleTimeInput.value > '17:00')) {
            timeError = 'Choose a time from 8:00 AM to 5:00 PM.';
        } else if (isToday && scheduleTimeInput.value && scheduleTimeInput.value < formatTime(earliestToday)) {
            timeError = 'Choose a later time today.';
        }
        scheduleTimeError.textContent = timeError;
        scheduleTimeError.hidden = !timeError;
        scheduleTimeInput.setAttribute('aria-invalid', String(Boolean(timeError)));
        scheduleTimeInput.setCustomValidity('');
        return { dateError, timeError };
    };

    const closeScheduleModal = () => {
        scheduleModal.classList.remove('open');
        scheduleForm.reset();
        updateScheduleConstraints();
        editingScheduleId = null;
        scheduleModalTitle.textContent = 'Add Collection Schedule';
        saveScheduleBtn.textContent = 'Save Schedule';
    };

    const openScheduleModal = (schedule = null) => {
        editingScheduleId = schedule?.id ?? null;
        scheduleForm.reset();
        if (schedule) {
            document.getElementById('scheduleDate').value = schedule.date || '';
            document.getElementById('scheduleTime').value = schedule.time || '';
            document.getElementById('scheduleType').value = schedule.scheduleType || 'One-Time';
            scheduleModalTitle.textContent = 'Edit Collection Schedule';
            saveScheduleBtn.textContent = 'Update Schedule';
        } else {
            scheduleModalTitle.textContent = 'Add Collection Schedule';
            saveScheduleBtn.textContent = 'Save Schedule';
        }
        updateScheduleConstraints();
        scheduleModal.classList.add('open');
    };

    scheduleDateInput.addEventListener('input', updateScheduleConstraints);
    scheduleDateInput.addEventListener('change', updateScheduleConstraints);
    scheduleTimeInput.addEventListener('input', updateScheduleConstraints);
    scheduleTimeInput.addEventListener('change', updateScheduleConstraints);
    updateScheduleConstraints();

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
            const barangay = schedule.barangay && schedule.barangay !== 'Global'
                ? schedule.barangay
                : 'East Bajac-Bajac';
            area.textContent = `Brgy. ${barangay}`;
            const dateTime = document.createElement('p');
            const displayDate = schedule.date
                ? new Date(`${schedule.date}T00:00:00`).toLocaleDateString('en-PH', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                })
                : 'Date not set';
            dateTime.textContent = `${displayDate} at ${formatScheduleTime(schedule.time)}`;
            details.append(area, dateTime);

            const badges = document.createElement('div');
            badges.className = 'lgu-schedule-badges';
            const type = document.createElement('span');
            type.className = 'lgu-schedule-type';
            type.textContent = schedule.scheduleType || 'One-Time';

            const status = document.createElement('span');
            status.className = `lgu-schedule-status ${schedule.collection_status === 'Done' ? 'is-done' : 'is-scheduled'}`;
            status.textContent = schedule.collection_status === 'Done' ? 'Done' : 'Scheduled';
            badges.append(type, status);

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
                if (!window.confirm('Delete this collection schedule?')) return;
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
            item.append(details, badges, actions);
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
        const { dateError, timeError } = updateScheduleConstraints();
        if (dateError) {
            scheduleDateInput.focus();
            return;
        }
        if (timeError) {
            scheduleTimeInput.focus();
            return;
        }
        if (!scheduleForm.reportValidity()) return;

        saveScheduleBtn.disabled = true;
        saveScheduleBtn.textContent = editingScheduleId ? 'Updating...' : 'Saving...';

        const date = scheduleDateInput.value;
        const time = scheduleTimeInput.value;
        const scheduleType = document.getElementById('scheduleType').value;
        const values = {
            title: 'Waste Collection Schedule',
            message: `Waste collection in Olongapo City on ${date} at ${time} (${scheduleType})`,
            barangay: 'Global',
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
    document.getElementById('count-available').innerText = allBins.filter(b => b.status?.toLowerCase() === 'available').length;
    document.getElementById('count-filling').innerText = allBins.filter(b => b.status?.toLowerCase() === 'filling').length;
    document.getElementById('count-full').innerText = allBins.filter(b => b.status?.toLowerCase() === 'full').length;

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
    if (!modal || !container) return;

    const matches = allBins.filter(b => b.status?.toLowerCase() === status);

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