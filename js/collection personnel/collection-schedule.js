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
        const isDone = schedule.collection_status === 'Done';

        const wrapper = document.createElement('div');
        wrapper.className = 'swipe-wrapper';

        const deleteBg = document.createElement('div');
        deleteBg.className = 'delete-bg';
        deleteBg.innerHTML = '<span>Delete</span>';

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
            desktopDeleteBtn.title = "Delete Schedule";
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
            item.setAttribute('aria-label', `Open collection actions for Brgy. ${schedule.barangay}, ${schedule.date} at ${schedule.time}`);
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

        const confirmDelete = (schedule) => {
        Swal.fire({
            title: 'Delete Schedule?',
            text: "You are about to delete this completed schedule permanently.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Yes, Delete',
            cancelButtonText: 'Cancel',
            buttonsStyling: false, /* VERY IMPORTANT: Disables default SweetAlert styles */
            customClass: {
                popup: 'binsense-swal',
                title: 'binsense-title',
                htmlContainer: 'binsense-text',
                actions: 'binsense-actions',
                confirmButton: 'binsense-confirm-btn',
                cancelButton: 'binsense-cancel-btn'
            }
                }).then(async (result) => {
            if (result.isConfirmed) {
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
            }
        });
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