import { confirmAction, confirmDiscard } from '../action-confirmation.js';
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
    let currYear = date.getFullYear();
    let currMonth = date.getMonth();
    const months = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    let isWasteCollector = false;
    let scheduledDates = new Set();
    let scheduledDatesCount = new Map();
    const getScheduleArea = schedule => schedule.barangay && schedule.barangay !== 'Global'
        ? `Brgy. ${schedule.barangay}`
        : 'Olongapo City';

    const closeCompletionModal = () => {
        doneConfirmModal.classList.remove('open');
        activeSchedule = null;
        confirmDoneBtn.disabled = false;
        confirmDoneBtn.textContent = 'Mark as Done';
    };

        const collectorNameInput = document.getElementById('collectorNameInput');
    let currentCollectorName = '';

    const openCompletionModal = (schedule) => {
        activeSchedule = schedule;
        doneScheduleDetails.textContent = `${getScheduleArea(schedule)} | ${schedule.date} at ${schedule.time}`;
        
        // Auto-fill ang pangalan ng naka-login
        collectorNameInput.value = currentCollectorName;
        
        doneConfirmModal.classList.add('open');
        collectorNameInput.focus();
    };

    const renderCalendar = () => {
        calendarDays.innerHTML = '';
        monthDisplay.innerText = `${months[currMonth]} ${currYear}`;
        const firstDayOfMonth = new Date(currYear, currMonth, 1).getDay();
        const lastDateOfMonth = new Date(currYear, currMonth + 1, 0).getDate();
        for (let index = 0; index < firstDayOfMonth; index++) calendarDays.innerHTML += '<div></div>';
        for (let day = 1; day <= lastDateOfMonth; day++) {
            const isToday = day === date.getDate() && currMonth === new Date().getMonth() && currYear === new Date().getFullYear() ? 'active' : '';
            const dateKey = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const hasSchedule = scheduledDates.has(dateKey);
            const scheduleClass = hasSchedule ? 'has-schedule' : '';
            const scheduleCount = scheduledDatesCount?.get(dateKey) || 0;
            const label = hasSchedule
                ? ` aria-label="${day} ${months[currMonth]} ${currYear}, ${scheduleCount} collection schedule${scheduleCount === 1 ? '' : 's'}"`
                : '';
            calendarDays.innerHTML += `<div class="${isToday} ${scheduleClass}"${label}><span>${day}</span></div>`;
        }
    };

        const renderItem = (schedule) => {
        const isDone = schedule.collection_status === 'Done';

        const wrapper = document.createElement('div');
        wrapper.className = 'swipe-wrapper';

        const deleteBg = document.createElement('div');
        deleteBg.className = 'delete-bg';
        deleteBg.innerHTML = '<span>Remove</span>';

        const item = document.createElement('article');
        item.className = 'schedule-item';

        const info = document.createElement('div');
        info.className = 'schedule-info';
        const area = document.createElement('h4');
        area.style.cssText = 'color: #48742C; margin-bottom: 2px;';
        area.textContent = getScheduleArea(schedule);
        const dateTime = document.createElement('p');
        dateTime.style.cssText = 'color: #888; font-size: 0.8rem;';
        dateTime.textContent = `Time: ${schedule.time || 'Not set'} | Date: ${schedule.date || 'Not set'}`;
        info.append(area, dateTime);

        const rightSide = document.createElement('div');
        rightSide.style.cssText = 'display: flex; align-items: center; gap: 10px;';

        const status = document.createElement('span');
        status.className = 'status-text';
        status.style.cssText = `color: ${isDone ? '#48742C' : '#888'}; font-weight: bold;`;
        status.textContent = isDone ? 'Done' : 'Scheduled';
        rightSide.appendChild(status);

        if (isDone) {
            item.classList.add('is-done');
            
            const desktopDeleteBtn = document.createElement('button');
            desktopDeleteBtn.className = 'delete-btn-desktop';
            desktopDeleteBtn.innerHTML = '&#128465;'; // Trash can icon
            desktopDeleteBtn.title = "Remove Completed Schedule";
            desktopDeleteBtn.onclick = (e) => {
                e.stopPropagation();
                confirmDelete(schedule);
            };
            rightSide.appendChild(desktopDeleteBtn);
        }

        item.append(info, rightSide);

        // Existing logic para sa pag mark as done
        if (isWasteCollector && !isDone) {
            item.classList.add('schedule-actionable');
            item.setAttribute('role', 'button');
            item.tabIndex = 0;
            item.setAttribute('aria-label', `Open collection actions for ${getScheduleArea(schedule)}, ${schedule.date} at ${schedule.time}`);
            item.addEventListener('click', () => openCompletionModal(schedule));
            item.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCompletionModal(schedule);
                }
            });
        }

        if (isDone) {
            let startX = 0;
            let currentX = 0;
            let isSwiping = false;

            item.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                isSwiping = true;
                item.style.transition = 'none';
            }, { passive: true });

            item.addEventListener('touchmove', (e) => {
                if (!isSwiping) return;
                currentX = e.touches[0].clientX - startX;
                
                if (currentX < 0) {
                    const move = Math.max(currentX, -80); 
                    item.style.transform = `translateX(${move}px)`;
                }
            }, { passive: true });

            item.addEventListener('touchend', () => {
                isSwiping = false;
                item.style.transition = 'transform 0.3s ease';
                
                if (currentX < -40) {
                    item.style.transform = `translateX(-80px)`;
                } else {
                    item.style.transform = `translateX(0)`;
                }
                currentX = 0;
            });

            deleteBg.onclick = () => {
                confirmDelete(schedule);
            };
        }

        // Isalpak lahat sa wrapper
        wrapper.append(deleteBg, item);
        scheduleList.appendChild(wrapper);
    };

    const confirmDelete = async schedule => {
        if (!await confirmAction({
            title: 'Remove this completed schedule?',
            message: 'The schedule will be hidden from your collection list.',
            action: 'Remove',
            cancel: 'Cancel'
        })) return;

        try {
            // Kukunin ang mga existing na nakatago
            let hiddenIds = JSON.parse(localStorage.getItem('hidden_collection_schedules') || '[]');

            // Idadagdag ang ID ng bagong tinatanggal
            if (!hiddenIds.includes(schedule.id)) {
                hiddenIds.push(schedule.id);
                localStorage.setItem('hidden_collection_schedules', JSON.stringify(hiddenIds));
            }

            Swal.fire({
                title: 'Removed!',
                text: 'The schedule has been removed from your list.',
                icon: 'success',
                iconColor: '#99cc33',
                confirmButtonText: 'Great!',
                buttonsStyling: false,
                customClass: {
                    popup: 'binsense-swal',
                    title: 'binsense-title',
                    htmlContainer: 'binsense-text',
                    actions: 'binsense-actions',
                    confirmButton: 'binsense-success-btn'
                }
            });
            await loadSchedules();
        } catch (error) {
            console.error('Hide failed:', error);
            Swal.fire({
                title: 'Error',
                text: 'Failed to remove the schedule. Please try again.',
                icon: 'error',
                iconColor: '#ff4444',
                confirmButtonText: 'Okay',
                buttonsStyling: false,
                customClass: {
                    popup: 'binsense-swal',
                    title: 'binsense-title',
                    htmlContainer: 'binsense-text',
                    actions: 'binsense-actions',
                    confirmButton: 'binsense-error-btn'
                }
            });
        }
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
        
        const hiddenIds = JSON.parse(localStorage.getItem('hidden_collection_schedules') || '[]');
        
        const visibleData = data ? data.filter(schedule => !hiddenIds.includes(schedule.id)) : [];
        scheduledDates = new Set();
        scheduledDatesCount = new Map();
        visibleData.forEach(schedule => {
            if (!schedule.date) return;
            const dateKey = String(schedule.date).slice(0, 10);
            scheduledDates.add(dateKey);
            scheduledDatesCount.set(dateKey, (scheduledDatesCount.get(dateKey) || 0) + 1);
        });
        renderCalendar();

        if (!visibleData?.length) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'empty-pill';
            emptyMessage.textContent = 'No collection schedules have been assigned.';
            scheduleList.appendChild(emptyMessage);
            return;
        }

        const fixedSchedules = visibleData.filter(schedule => schedule.scheduleType === 'Fixed');
        const oneTimeSchedules = visibleData.filter(schedule => schedule.scheduleType !== 'Fixed');
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

    const dismissCompletionModal = async () => {
        if (confirmDoneBtn.disabled) return;
        if (collectorNameInput.value !== currentCollectorName &&
            !await confirmDiscard('Your changes to the collector name will be lost.')) return;
        closeCompletionModal();
    };

    document.getElementById('cancelDoneBtn').addEventListener('click', dismissCompletionModal);
    doneConfirmModal.addEventListener('click', event => {
        if (event.target === doneConfirmModal) dismissCompletionModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && doneConfirmModal.classList.contains('open') &&
            !document.querySelector('.action-confirmation[open]')) dismissCompletionModal();
    });
        confirmDoneBtn.addEventListener('click', async () => {
        if (!activeSchedule) return;
        
        const actualName = collectorNameInput.value.trim();
        if (!actualName) {
            Swal.fire({
                title: 'Name Required',
                text: 'Please enter the collector\'s name before submitting.',
                icon: 'warning',
                iconColor: '#ff9800',
                confirmButtonText: 'Okay',
                buttonsStyling: false,
                customClass: {
                    popup: 'binsense-swal',
                    title: 'binsense-title',
                    htmlContainer: 'binsense-text',
                    actions: 'binsense-actions',
                    confirmButton: 'binsense-success-btn' /* Green button for warning is okay, or make an orange one */
                }
            });
            return;
        }

        confirmDoneBtn.disabled = true;
        confirmDoneBtn.textContent = 'Submitting...';
        
        const { data, error } = await supabase.rpc('complete_collection_with_record', { 
            p_schedule_id: activeSchedule.id,
            p_bin_id: activeSchedule.bin_id || null, 
            p_actual_name: actualName,
            p_barangay: activeSchedule.barangay || null 
        });

        if (error || data !== true) {
            console.error('Collection completion failed:', error || 'Schedule is already complete or unavailable.');
            window.alert(error?.message || 'This schedule could not be marked done. Refresh and try again.');
            confirmDoneBtn.disabled = false;
            confirmDoneBtn.textContent = 'Confirm & Submit';
            return;
        }
        
        closeCompletionModal();
        await loadSchedules();
        
        // Optional: Success alert
        Swal.fire({
            title: 'Success!',
            text: 'Collection record has been saved.',
            icon: 'success',
            iconColor: '#99cc33',
            confirmButtonText: 'Great!',
            buttonsStyling: false,
            customClass: {
                popup: 'binsense-swal',
                title: 'binsense-title',
                htmlContainer: 'binsense-text',
                actions: 'binsense-actions',
                confirmButton: 'binsense-success-btn'
            }
        });
    });

    renderCalendar();
    document.getElementById('prevMonth')?.addEventListener('click', () => {
        currMonth--;
        if (currMonth < 0) {
            currMonth = 11;
            currYear--;
        }
        renderCalendar();
    });
    document.getElementById('nextMonth')?.addEventListener('click', () => {
        currMonth++;
        if (currMonth > 11) {
            currMonth = 0;
            currYear++;
        }
        renderCalendar();
    });

    const loadCollectorRole = async () => {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            scheduleList.innerHTML = '<p class="empty-pill">Sign in to view assigned collection schedules.</p>';
            return;
        }
                // Kinukuha natin pati yung 'name' para may auto-fill
        const { data: profile, error } = await supabase.from('users')
            .select('role, name')
            .eq('id', user.id)
            .maybeSingle();
        if (error) {
            console.error('Collector role verification failed:', error);
            scheduleList.innerHTML = '<p class="empty-pill">Unable to verify collection personnel access.</p>';
            return;
        }
        isWasteCollector = profile?.role === 'waste collector';
        currentCollectorName = profile?.name || 'Waste Collector';
        await loadSchedules();
    };

    loadCollectorRole();
    supabase.channel('collector-collection-schedules')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'type=eq.collection' }, loadCollectorRole)
        .subscribe();
});