const REPORT_STATUSES = ['Pending', 'In Progress', 'Resolved'];

export async function initializeLguNotifications(supabase) {
    const header = document.querySelector('.top-nav');
    if (!header || header.querySelector('.lgu-notification-wrapper')) return;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
        console.error('Unable to verify LGU notification access:', authError);
        return;
    }
    if (!user) return;

    const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profileError) {
        console.error('Unable to verify LGU notification role:', profileError);
        return;
    }
    if (profile?.role !== 'lgu admin') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'lgu-notification-wrapper';
    wrapper.innerHTML = `
        <button class="lgu-notification-button" type="button" aria-label="Open incident notifications" aria-expanded="false">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
        </button>
        <section class="lgu-notification-panel" aria-label="Incident notifications" hidden>
            <div class="lgu-notification-header">
                <h2>Notifications</h2>
                <div class="lgu-notification-header-actions">
                    <button class="lgu-mark-all-button" type="button">Mark all as read</button>
                    <button class="lgu-notification-close" type="button" aria-label="Close notifications">&times;</button>
                </div>
            </div>
            <div class="lgu-notification-list" aria-live="polite">
                <p class="lgu-notification-empty">Loading notifications...</p>
            </div>
        </section>
    `;
    header.appendChild(wrapper);

    const detailLayer = document.createElement('div');
    detailLayer.className = 'lgu-report-detail-layer';
    detailLayer.hidden = true;
    detailLayer.innerHTML = `
        <section class="lgu-report-detail" role="dialog" aria-modal="true" aria-labelledby="lguReportDetailTitle">
            <header class="lgu-report-detail-header">
                <h2 id="lguReportDetailTitle">Incident report</h2>
                <button class="lgu-report-detail-close" type="button" aria-label="Close report details">&times;</button>
            </header>
            <div class="lgu-report-detail-body">
                <p class="lgu-notification-empty">Loading report details...</p>
            </div>
            <footer class="lgu-report-detail-footer">
                <label for="lguReportStatus">Incident status</label>
                <select id="lguReportStatus">
                    ${REPORT_STATUSES.map(status => `<option>${status}</option>`).join('')}
                </select>
                <button class="lgu-report-status-save" type="button">Save status</button>
                <p class="lgu-report-status-message" role="status"></p>
            </footer>
        </section>
    `;
    document.body.appendChild(detailLayer);

    const button = wrapper.querySelector('.lgu-notification-button');
    const panel = wrapper.querySelector('.lgu-notification-panel');
    const list = wrapper.querySelector('.lgu-notification-list');
    const markAllButton = wrapper.querySelector('.lgu-mark-all-button');
    const detailBody = detailLayer.querySelector('.lgu-report-detail-body');
    const statusSelect = detailLayer.querySelector('#lguReportStatus');
    const statusSaveButton = detailLayer.querySelector('.lgu-report-status-save');
    const statusMessage = detailLayer.querySelector('.lgu-report-status-message');
    let activeReport = null;
    let loadRequest = 0;

    const setPanelOpen = isOpen => {
        panel.hidden = !isOpen;
        button.setAttribute('aria-expanded', String(isOpen));
    };

    const setBadge = count => {
        let badge = button.querySelector('.lgu-notification-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'lgu-notification-badge';
                button.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : String(count);
            button.setAttribute('aria-label', `${count} unread incident notifications`);
        } else {
            badge?.remove();
            button.setAttribute('aria-label', 'Open incident notifications');
        }
        markAllButton.disabled = count === 0;
    };

    const setListMessage = message => {
        list.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'lgu-notification-empty';
        empty.textContent = message;
        list.appendChild(empty);
    };

    const loadNotifications = async () => {
        const requestId = ++loadRequest;
        const [notificationResult, unreadResult] = await Promise.all([
            supabase.from('lgu_admin_notifications')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100),
            supabase.from('lgu_admin_notifications')
                .select('id', { count: 'exact', head: true })
                .eq('is_read', false)
        ]);
        if (requestId !== loadRequest) return;

        if (notificationResult.error) {
            console.error('Unable to load LGU incident notifications:', notificationResult.error);
            setListMessage('Unable to load notifications. Please try again.');
            return;
        }
        if (unreadResult.error) {
            console.error('Unable to load unread LGU notification count:', unreadResult.error);
            setListMessage('Unable to load notification status. Please try again.');
            return;
        }

        setBadge(unreadResult.count || 0);
        const notifications = notificationResult.data || [];
        if (!notifications.length) {
            setListMessage('No incident notifications yet.');
            return;
        }

        list.replaceChildren();
        notifications.forEach(notification => {
            const item = document.createElement('article');
            item.className = `lgu-notification-item${notification.is_read ? '' : ' is-unread'}`;

            const openButton = document.createElement('button');
            openButton.className = 'lgu-notification-open';
            openButton.type = 'button';

            const title = document.createElement('span');
            title.className = 'lgu-notification-title';
            title.textContent = notification.title;

            const message = document.createElement('span');
            message.className = 'lgu-notification-message';
            message.textContent = notification.message;

            const incidentStatus = document.createElement('span');
            incidentStatus.className = 'lgu-notification-status';
            incidentStatus.textContent = `Incident: ${notification.incident_status || 'Pending'}`;

            const timestamp = document.createElement('time');
            timestamp.className = 'lgu-notification-time';
            timestamp.dateTime = notification.created_at;
            timestamp.textContent = formatTimestamp(notification.created_at);

            openButton.append(title, message, incidentStatus, timestamp);
            openButton.addEventListener('click', () => openReport(notification));
            item.appendChild(openButton);

            if (!notification.is_read) {
                const readButton = document.createElement('button');
                readButton.className = 'lgu-mark-read-button';
                readButton.type = 'button';
                readButton.textContent = 'Mark as read';
                readButton.addEventListener('click', () => markAsRead(notification.id));
                item.appendChild(readButton);
            } else {
                const readLabel = document.createElement('span');
                readLabel.className = 'lgu-read-label';
                readLabel.textContent = 'Read';
                item.appendChild(readLabel);
            }
            list.appendChild(item);
        });
    };

    const markAsRead = async notificationId => {
        const { error } = await supabase.from('lgu_admin_notifications')
            .update({ is_read: true })
            .eq('id', notificationId)
            .eq('is_read', false);
        if (error) {
            console.error('Unable to mark LGU notification as read:', error);
            setListMessage('Unable to update notification. Please try again.');
            return false;
        }
        await loadNotifications();
        return true;
    };

    const openReport = async notification => {
        setPanelOpen(false);
        detailLayer.hidden = false;
        detailBody.replaceChildren();
        statusMessage.textContent = '';
        statusSelect.disabled = true;
        statusSaveButton.disabled = true;
        detailLayer.querySelector('#lguReportDetailTitle').textContent = 'Incident report';
        const reportReference = notification.report_id
            ? { table: 'reports', id: notification.report_id }
            : { table: 'incident_reports', id: notification.incident_report_id };
        activeReport = reportReference;

        const markResult = notification.is_read ? true : await markAsRead(notification.id);
        if (!markResult) {
            statusMessage.textContent = 'The report is open, but its notification could not be marked as read.';
        }
        const loadingMessage = document.createElement('p');
        loadingMessage.className = 'lgu-notification-empty';
        loadingMessage.textContent = 'Loading report details...';
        detailBody.appendChild(loadingMessage);

        const { data: report, error } = await supabase
            .from(reportReference.table)
            .select(reportReference.table === 'reports'
                ? 'id, bin_id, issue, timestamp, collector, status'
                : 'id, email, title, description, severity, timestamp, status, bin_id, location')
            .eq('id', reportReference.id)
            .maybeSingle();

        if (activeReport !== reportReference) return;
        if (error || !report) {
            if (error) console.error('Unable to load incident report details:', error);
            renderDetailError(error ? 'Unable to load the complete incident report.' : 'This incident report is no longer available.');
            return;
        }

        const reportTitle = reportReference.table === 'reports' ? report.issue : report.title;
        detailLayer.querySelector('#lguReportDetailTitle').textContent = reportTitle || 'Incident report';
        statusSelect.value = REPORT_STATUSES.includes(report.status) ? report.status : 'Pending';
        statusSelect.disabled = false;
        statusSaveButton.disabled = false;
        activeReport = { ...reportReference, report };

        addDetailField('Issue', reportTitle || 'Not provided');
        if (reportReference.table === 'incident_reports' && report.description) {
            addDetailField('Description', report.description);
            addDetailField('Severity', report.severity || 'Not provided');
        }
        addDetailField('Bin', notification.bin_id || report.bin_id || 'Not applicable');
        addDetailField('Location / area', notification.location || report.location || 'Not provided');
        addDetailField('Submitted by', notification.submitter_name || report.collector || report.email || 'Not provided');
        addDetailField('Submitted', formatTimestamp(report.timestamp || notification.created_at));
    };

    const addDetailField = (label, value) => {
        const field = document.createElement('div');
        field.className = 'lgu-report-detail-field';
        const fieldLabel = document.createElement('span');
        fieldLabel.className = 'lgu-report-detail-label';
        fieldLabel.textContent = label;
        const fieldValue = document.createElement('p');
        fieldValue.textContent = value;
        field.append(fieldLabel, fieldValue);
        detailBody.appendChild(field);
    };

    const renderDetailError = message => {
        detailBody.replaceChildren();
        const errorMessage = document.createElement('p');
        errorMessage.className = 'lgu-report-detail-error';
        errorMessage.textContent = message;
        detailBody.appendChild(errorMessage);
        statusSelect.disabled = true;
        statusSaveButton.disabled = true;
    };

    const saveReportStatus = async () => {
        if (!activeReport) return;
        statusSaveButton.disabled = true;
        statusMessage.textContent = 'Saving status...';
        const { error } = await supabase.from(activeReport.table)
            .update({ status: statusSelect.value })
            .eq('id', activeReport.id);
        statusSaveButton.disabled = false;
        if (error) {
            console.error('Unable to update incident report status:', error);
            statusMessage.textContent = 'Unable to save status. Please try again.';
            return;
        }
        statusMessage.textContent = 'Incident status updated.';
    };

    button.addEventListener('click', () => {
        const isOpening = panel.hidden;
        setPanelOpen(isOpening);
        if (isOpening) loadNotifications();
    });
    wrapper.querySelector('.lgu-notification-close').addEventListener('click', () => setPanelOpen(false));
    markAllButton.addEventListener('click', async () => {
        markAllButton.disabled = true;
        const { error } = await supabase.from('lgu_admin_notifications')
            .update({ is_read: true })
            .eq('is_read', false);
        if (error) {
            console.error('Unable to mark LGU notifications as read:', error);
            markAllButton.disabled = false;
            setListMessage('Unable to update notifications. Please try again.');
            return;
        }
        await loadNotifications();
    });

    const closeDetails = () => {
        detailLayer.hidden = true;
        activeReport = null;
    };
    detailLayer.querySelector('.lgu-report-detail-close').addEventListener('click', closeDetails);
    detailLayer.addEventListener('click', event => {
        if (event.target === detailLayer) closeDetails();
    });
    statusSaveButton.addEventListener('click', saveReportStatus);
    document.addEventListener('click', event => {
        if (!wrapper.contains(event.target)) setPanelOpen(false);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            setPanelOpen(false);
            closeDetails();
        }
    });

    const channel = supabase.channel('lgu-admin-incident-notifications')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'lgu_admin_notifications'
        }, loadNotifications)
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.error(`LGU notification realtime subscription failed: ${status}`);
            }
        });

    window.addEventListener('pagehide', () => {
        supabase.removeChannel(channel);
        detailLayer.remove();
    }, { once: true });

    await loadNotifications();
}

function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
