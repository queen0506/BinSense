import { supabase } from '../supabase-init.js';

document.addEventListener('DOMContentLoaded', () => {
    const calendarDays = document.getElementById('calendarDays');
    const monthDisplay = document.getElementById('monthDisplay');
    const scheduleList = document.getElementById('scheduleList');
    const doneConfirmModal = document.getElementById('doneConfirmModal');
    const doneScheduleDetails = document.getElementById('doneScheduleDetails');
    const confirmDoneBtn = document.getElementById('confirmDoneBtn');
    let activeSchedule = null;

    const date = new Date();
    const currYear = date.getFullYear();
    const currMonth = date.getMonth();
    const months = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    let isWasteCollector = false;

    const closeCompletionModal = () => {
        doneConfirmModal.classList.remove('open');
        activeSchedule = null;
        confirmDoneBtn.disabled = false;
        confirmDoneBtn.textContent = 'Mark as Done';
    };

    const openCompletionModal = (schedule) => {
        activeSchedule = schedule;
        doneScheduleDetails.textContent = `Brgy. ${schedule.barangay} | ${schedule.date} at ${schedule.time}`;
        doneConfirmModal.classList.add('open');
        confirmDoneBtn.focus();
    };

    const renderCalendar = () => {
        calendarDays.innerHTML = '';
        monthDisplay.innerText = `${months[currMonth]} ${currYear}`;
        const firstDayOfMonth = new Date(currYear, currMonth, 1).getDay();
        const lastDateOfMonth = new Date(currYear, currMonth + 1, 0).getDate();
        for (let index = 0; index < firstDayOfMonth; index++) calendarDays.innerHTML += '<div></div>';
        for (let day = 1; day <= lastDateOfMonth; day++) {
            const isToday = day === date.getDate() && currMonth === new Date().getMonth() && currYear === new Date().getFullYear() ? 'active' : '';
            calendarDays.innerHTML += `<div class="${isToday}">${day}</div>`;
        }
    };

    const renderItem = (schedule) => {
        const item = document.createElement('article');
        item.className = 'schedule-item';

        const info = document.createElement('div');
        info.className = 'schedule-info';
        const area = document.createElement('h4');
        area.style.cssText = 'color: #48742C; margin-bottom: 2px;';
        area.textContent = `Brgy. ${schedule.barangay || 'Unassigned'}`;
        const dateTime = document.createElement('p');
        dateTime.style.cssText = 'color: #888; font-size: 0.8rem;';
        dateTime.textContent = `Time: ${schedule.time || 'Not set'} | Date: ${schedule.date || 'Not set'}`;
        info.append(area, dateTime);

        const status = document.createElement('span');
        status.className = 'status-text';
        const isDone = schedule.collection_status === 'Done';
        status.style.cssText = `color: ${isDone ? '#48742C' : '#888'}; font-weight: bold;`;
        status.textContent = isDone ? 'Done' : 'Scheduled';

        item.append(info, status);
        if (isWasteCollector && !isDone) {
            item.classList.add('schedule-actionable');
            item.setAttribute('role', 'button');
            item.tabIndex = 0;
            item.setAttribute('aria-label', `Open collection actions for Brgy. ${schedule.barangay}, ${schedule.date} at ${schedule.time}`);
            item.addEventListener('click', () => openCompletionModal(schedule));
            item.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCompletionModal(schedule);
                }
            });
        }
        scheduleList.appendChild(item);
    };

    const loadSchedules = async () => {
        const { data, error } = await supabase.from('notifications')
            .select('*')
            .eq('type', 'collection')
            .order('date', { ascending: true })
            .order('time', { ascending: true });

        if (error) {
            console.error('Collection schedule load failed:', error);
            scheduleList.innerHTML = '<p class="empty-pill">Unable to load collection schedules.</p>';
            return;
        }

        scheduleList.innerHTML = '';
        if (!data?.length) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'empty-pill';
            emptyMessage.textContent = 'No collection schedules have been assigned.';
            scheduleList.appendChild(emptyMessage);
            return;
        }

        const fixedSchedules = data.filter(schedule => schedule.scheduleType === 'Fixed');
        const oneTimeSchedules = data.filter(schedule => schedule.scheduleType !== 'Fixed');
        if (fixedSchedules.length) {
            const label = document.createElement('div');
            label.className = 'fixed-label';
            label.textContent = 'Fixed Schedules';
            scheduleList.appendChild(label);
            fixedSchedules.forEach(renderItem);
        }
        if (fixedSchedules.length && oneTimeSchedules.length) {
            const divider = document.createElement('div');
            divider.className = 'schedule-divider';
            scheduleList.appendChild(divider);
        }
        oneTimeSchedules.forEach(renderItem);
    };

    document.getElementById('cancelDoneBtn').addEventListener('click', closeCompletionModal);
    doneConfirmModal.addEventListener('click', event => {
        if (event.target === doneConfirmModal) closeCompletionModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && doneConfirmModal.classList.contains('open')) closeCompletionModal();
    });
    confirmDoneBtn.addEventListener('click', async () => {
        if (!activeSchedule) return;
        confirmDoneBtn.disabled = true;
        confirmDoneBtn.textContent = 'Updating...';
        const { data, error } = await supabase.rpc('complete_collection_schedule', { p_schedule_id: activeSchedule.id });
        if (error || data !== true) {
            console.error('Collection completion failed:', error || 'Schedule is already complete or unavailable.');
            window.alert(error?.message || 'This schedule could not be marked done. Refresh and try again.');
            confirmDoneBtn.disabled = false;
            confirmDoneBtn.textContent = 'Mark as Done';
            return;
        }
        closeCompletionModal();
        await loadSchedules();
    });

    renderCalendar();
    const loadCollectorRole = async () => {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            scheduleList.innerHTML = '<p class="empty-pill">Sign in to view assigned collection schedules.</p>';
            return;
        }
        const { data: profile, error } = await supabase.from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();
        if (error) {
            console.error('Collector role verification failed:', error);
            scheduleList.innerHTML = '<p class="empty-pill">Unable to verify collection personnel access.</p>';
            return;
        }
        isWasteCollector = profile?.role === 'waste collector';
        await loadSchedules();
    };

    loadCollectorRole();
    supabase.channel('collector-collection-schedules')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'type=eq.collection' }, loadCollectorRole)
        .subscribe();
});