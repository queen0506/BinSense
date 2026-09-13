import { supabase } from '../supabase-init.js';

async function writeLog(action, message, category = 'logs') {
    const { data: { user } } = await supabase.auth.getUser();
    try {
        await supabase.from('system_logs').insert({
            action: action,
            message: message,
            category: category,
            timestamp: new Date().toISOString(),
            email: user ? user.email : "Collector",
            role: "Collector"
        });
    } catch (e) { console.error("Logging failed:", e); }
}

function withTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
            reject(new Error('The server did not respond. Check your internet connection and Supabase project status.'));
        }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

document.addEventListener('DOMContentLoaded', () => {
    const calendarDays = document.getElementById('calendarDays');
    const monthDisplay = document.getElementById('monthDisplay');
    const scheduleList = document.getElementById('scheduleList');
    
    const modal = document.getElementById('addScheduleModal');
    const addBtn = document.getElementById('addScheduleBtn');
    const closeBtn = document.getElementById('closeModal');
    const scheduleForm = document.getElementById('modalScheduleForm');
    const broadcastButton = scheduleForm?.querySelector('button[type="submit"]');

    const cancelModal = document.getElementById('cancelConfirmModal');
    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    const closeCancelModal = document.getElementById('closeCancelModal');
    const cancelBrgyName = document.getElementById('cancelBrgyName');
    let activeCancelData = null;

    let date = new Date();
    let currYear = date.getFullYear();
    let currMonth = date.getMonth();

    const months = ["January", "February", "March", "April", "May", "June", 
                    "July", "August", "September", "October", "November", "December"];

    const renderCalendar = () => {
        calendarDays.innerHTML = "";
        monthDisplay.innerText = `${months[currMonth]} ${currYear}`;
        let firstDayofMonth = new Date(currYear, currMonth, 1).getDay();
        let lastDateofMonth = new Date(currYear, currMonth + 1, 0).getDate();
        for (let i = 0; i < firstDayofMonth; i++) calendarDays.innerHTML += `<div></div>`;
        for (let i = 1; i <= lastDateofMonth; i++) {
            let isToday = i === date.getDate() && currMonth === new Date().getMonth() && currYear === new Date().getFullYear() ? "active" : "";
            calendarDays.innerHTML += `<div class="${isToday}">${i}</div>`;
        }
    };
    renderCalendar();

    const loadSchedules = async () => {
        const { data, error } = await supabase.from('notifications').select('*').eq('type', 'collection');
        if (error) { console.error(error); return; }
            scheduleList.innerHTML = ""; 
            if (!data?.length) {
                scheduleList.innerHTML = '<p class="empty-pill">No active schedules.</p>';
                return;
            }
            const schedules = data.map(value => [value.id, value]);

            // Categorize
            const fixed = schedules.filter(([k, v]) => v.scheduleType === "Fixed");
            const oneTime = schedules.filter(([k, v]) => v.scheduleType !== "Fixed");

            // 1. Render Fixed
            if (fixed.length > 0) {
                const label = document.createElement('div');
                label.className = 'fixed-label';
                label.innerText = "Fixed Schedules";
                scheduleList.appendChild(label);
                fixed.forEach(([key, val]) => renderItem(key, val));
            }

            // 2. Divider
            if (fixed.length > 0 && oneTime.length > 0) {
                const div = document.createElement('div');
                div.className = 'schedule-divider';
                scheduleList.appendChild(div);
            }

            // 3. One-Time
            oneTime.reverse().forEach(([key, val]) => renderItem(key, val));
    };

    function renderItem(key, val) {
        const newItem = document.createElement('div');
        newItem.className = 'schedule-item';
        newItem.innerHTML = `
            <div class="schedule-info">
                <h4 style="color: #48742C; margin-bottom: 2px;">Brgy. ${val.barangay}</h4>
                <p style="color: #888; font-size: 0.8rem;">⏰ ${val.time} | 📅 ${val.date}</p>
            </div>
            <span class="status-text" style="color: ${val.scheduleType === 'Fixed' ? '#99cc33' : '#99cc33'}; font-weight: bold;">
                ${val.scheduleType || 'Sent'}
            </span>
        `;
        newItem.onclick = () => {
            activeCancelData = { id: key, brgy: val.barangay, date: val.date, time: val.time };
            cancelBrgyName.innerText = `Brgy. ${val.barangay}`;
            cancelModal.classList.add('open');
        };
        scheduleList.appendChild(newItem);
    }

    loadSchedules();

    scheduleForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('modalScheduleType').value;
        const brgy = document.getElementById('modalBarangay').value.trim();
        const dateV = document.getElementById('modalDate').value;
        const timeV = document.getElementById('modalTime').value;

        if (!brgy || !dateV || !timeV) {
            await Swal.fire({
                title: 'Complete the schedule',
                text: 'Enter the barangay, date, and time before broadcasting.',
                icon: 'warning',
                confirmButtonColor: '#99cc33'
            });
            return;
        }

        try {
            if (broadcastButton) {
                broadcastButton.disabled = true;
                broadcastButton.textContent = 'Broadcasting...';
            }
            const { error } = await withTimeout(
                supabase.from('notifications').insert({
                    title: "Waste Collection Schedule",
                    message: `Waste collection in Brgy. ${brgy} on ${dateV} at ${timeV} (${type})`,
                    barangay: brgy,
                    date: dateV,
                    time: timeV,
                    scheduleType: type,
                    created_at: new Date().toISOString(),
                    type: "collection",
                    status: "unread"
                }),
                10000
            );
            if (error) throw error;

            Swal.fire({ title: 'Broadcast Sent!', icon: 'success', confirmButtonColor: '#99cc33' });
            modal.classList.remove('open');
            scheduleForm.reset();
            loadSchedules();
        } catch (error) {
            console.error('Schedule broadcast failed:', error);
            await Swal.fire({
                title: 'Broadcast failed',
                text: error.message || 'Unable to save the schedule. Please try again.',
                icon: 'error',
                confirmButtonColor: '#99cc33'
            });
        } finally {
            if (broadcastButton) {
                broadcastButton.disabled = false;
                broadcastButton.textContent = 'Broadcast';
            }
        }
    });

    confirmCancelBtn.onclick = async () => {
        if (!activeCancelData) return;
        const { error } = await supabase.from('notifications').delete().eq('id', activeCancelData.id);
        if (error) { console.error(error); return; }
        cancelModal.classList.remove('open');
        Swal.fire({ title: 'Schedule Removed', icon: 'info' });
    };

    // Standard UI Listeners
    addBtn.onclick = () => modal.classList.add('open');
    closeBtn.onclick = () => { modal.classList.remove('open'); scheduleForm.reset(); };
    closeCancelModal.onclick = () => cancelModal.classList.remove('open');
});