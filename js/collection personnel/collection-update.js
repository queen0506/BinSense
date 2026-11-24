import { supabase } from '../supabase-init.js';

/**
 * SHARED LOGGING FUNCTION
 */
async function writeLog(action, message, category = 'logs') {
    const { data: { user } } = await supabase.auth.getUser();
    try {
        await supabase.from('system_logs').insert({
            action: action,
            message: message,
            category: category,
            timestamp: new Date().toISOString(),
            email: user ? user.email : "Personnel_01",
            role: "Collector"
        });
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const binSelectionView = document.getElementById('binSelectionView');
    const binDetailView = document.getElementById('binDetailView');
    const displayBinID = document.getElementById('displayBinID');
    const displayStatus = document.getElementById('displayStatus');
    const displayFill = document.getElementById('displayFill');
    const statusIndicator = binDetailView.querySelector('.status-indicator');
    const backBtn = document.getElementById('backToList');
    const binContainer = document.getElementById('binContainer');
    const binSearch = document.getElementById('binSearch');
    const submitUpdateBtn = document.getElementById('submitUpdate');
    const incidentReportsContainer = document.getElementById('myIncidentReports');

    let allBins = {}; 
    let activeBinId = null;
    let binRequest = 0;
    let activeCollectorEmail = null;
    let incidentReportRequest = 0;

    function getBinReading(bin) {
        const status = String(bin.status ?? '').trim().toLowerCase();
        const colors = {
            available: '#48742c',
            filling: '#8a5700',
            full: '#b42318'
        };
        const color = Object.hasOwn(colors, status) ? colors[status] : null;
        const level = bin.level ?? bin.volume;
        const percentage = Number(level);
        const hasFill = level != null && String(level).trim() !== '' &&
            Number.isFinite(percentage) && percentage >= 0 && percentage <= 100;
        return {
            label: color ? status.toUpperCase() : 'UNKNOWN',
            color: color || '#667085',
            fill: hasFill ? `${percentage}% full` : 'Fill level unavailable'
        };
    }

    const loadBins = async () => {
        const request = ++binRequest;
        const { data, error } = await supabase.from('bins').select('*');
        if (request !== binRequest) return;
        if (error) {
            console.error('Unable to load bins:', error);
            binContainer.innerHTML = '<p class="section-message error-message">Unable to load bins. Please try again.</p>';
            return;
        }

        allBins = Object.fromEntries((data ?? []).map(bin => [bin.id, bin]));
        if (data?.length) {
            renderBins(allBins, binSearch.value);
        } else {
            binContainer.innerHTML = '<p class="section-message">No bins found.</p>';
        }

        if (activeBinId !== null) {
            const bin = allBins[activeBinId];
            if (bin) renderBinDetail(bin);
            else closeDetailView();
        }
    };

    function renderBins(bins, filter = "") {
        binContainer.innerHTML = ""; 
        Object.keys(bins).forEach(id => {
            const bin = bins[id];
            const binDisplayId = id.replace('bin_', '#');
            const searchText = `${binDisplayId} ${bin.barangay || ''}`.toLowerCase();
            if (searchText.includes(filter.trim().toLowerCase())) {
                const reading = getBinReading(bin);
                const card = document.createElement('button');
                card.className = 'bin-card clickable-bin';
                card.type = 'button';
                card.setAttribute('aria-label', `View bin ${binDisplayId}, ${reading.label}, ${reading.fill}`);

                const content = document.createElement('span');
                content.className = 'bin-card-content';
                const name = document.createElement('span');
                name.className = 'bin-name';
                name.textContent = `BIN ${binDisplayId}`;
                const meta = document.createElement('span');
                meta.className = 'bin-card-meta';
                const fillLevel = document.createElement('span');
                fillLevel.textContent = reading.fill;
                meta.appendChild(fillLevel);
                const status = document.createElement('span');
                status.className = 'sample-label';
                status.style.color = reading.color;
                status.textContent = reading.label;
                meta.appendChild(status);
                content.append(name, meta);

                const indicator = document.createElement('span');
                indicator.className = 'bin-status-indicator';
                indicator.style.backgroundColor = reading.color;
                indicator.setAttribute('aria-hidden', 'true');
                const chevron = document.createElement('span');
                chevron.className = 'chevron';
                chevron.textContent = '›';
                card.append(content, indicator, chevron);
                card.addEventListener('click', () => showDetail(id));
                binContainer.appendChild(card);
            }
        });
        if (!binContainer.children.length) {
            binContainer.innerHTML = '<p class="section-message">No bins match your search.</p>';
        }
    }

    const loadIncidentReports = async () => {
        if (!activeCollectorEmail) {
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Sign in to view your incident reports.</p>';
            return;
        }

        const requestId = ++incidentReportRequest;
        const { data: reports, error } = await supabase.from('reports')
            .select('id, bin_id, issue, timestamp, collector, status')
            .eq('collector', activeCollectorEmail)
            .order('timestamp', { ascending: false })
            .limit(100);

        if (requestId !== incidentReportRequest) return;
        if (error) {
            console.error('Unable to load your incident reports:', error);
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Unable to load your reports. Please try again.</p>';
            return;
        }

        const activeReports = (reports || []).filter(report =>
            String(report.status || 'Pending').toLowerCase() !== 'resolved'
        );
        if (!activeReports.length) {
            incidentReportsContainer.innerHTML = '<p class="section-message">No active incident reports.</p>';
            return;
        }

        const reportBinIds = [...new Set(activeReports
            .map(report => report.bin_id)
            .filter(binId => typeof binId === 'string' && binId.trim()))];
        const reportLocationLabels = new Map();
        if (reportBinIds.length) {
            try {
                const { data: addresses, error: addressError } = await supabase.rpc(
                    'get_collector_report_bin_addresses',
                    { p_bin_ids: reportBinIds }
                );
                if (requestId !== incidentReportRequest) return;
                if (addressError) {
                    console.error('Unable to load incident report addresses:', addressError);
                } else {
                    (addresses || [])
                        .filter(row => reportBinIds.includes(row.bin_id) &&
                            typeof row.location_label === 'string' &&
                            row.location_label.trim())
                        .forEach(row => reportLocationLabels.set(row.bin_id, row.location_label.trim()));
                }
            } catch (addressError) {
                console.error('Unable to load incident report addresses:', addressError);
            }
        }

        const missingBinIds = [...new Set(activeReports
            .filter(report => report.bin_id &&
                !reportLocationLabels.has(report.bin_id) &&
                !allBins[report.bin_id]?.barangay)
            .map(report => report.bin_id))];
        let reportBins = {};
        if (missingBinIds.length) {
            const { data: bins, error: binError } = await supabase.from('bins')
                .select('id, barangay, street')
                .in('id', missingBinIds);
            if (requestId !== incidentReportRequest) return;
            if (binError) {
                console.error('Unable to load incident report bin locations:', binError);
            } else {
                reportBins = Object.fromEntries((bins || []).map(bin => [bin.id, bin]));
            }
        }

        if (requestId !== incidentReportRequest) return;
        incidentReportsContainer.replaceChildren();
        activeReports.forEach(report => {
            const statusText = report.status || 'Pending';
            const normalizedStatus = statusText.toLowerCase().replace(/\s+/g, '-');
            const bin = allBins[report.bin_id] || reportBins[report.bin_id];
            const card = document.createElement('article');
            card.className = 'incident-report-card';

            const header = document.createElement('div');
            header.className = 'incident-report-header';
            const binName = document.createElement('h3');
            binName.textContent = report.bin_id ? report.bin_id.replace(/^bin_/, 'BIN ') : 'Bin not specified';
            const status = document.createElement('span');
            status.className = `incident-status status-${normalizedStatus}`;
            status.textContent = statusText;
            header.append(binName, status);

            const issue = document.createElement('p');
            issue.className = 'incident-report-issue';
            issue.textContent = report.issue || 'Reported issue';
            const location = document.createElement('p');
            location.className = 'incident-report-location';
            const reportLocation = reportLocationLabels.get(report.bin_id);
            const barangay = String(bin?.barangay || '').trim();
            const street = String(bin?.street || '').trim();
            const isUsableLocation = value => value && !/^(unassigned|unknown|n\/a|not specified|global)$/i.test(value);
            location.textContent = reportLocation
                ? `Location: ${reportLocation}`
                : isUsableLocation(barangay)
                    ? `Area: ${barangay}`
                    : isUsableLocation(street)
                        ? `Location: ${street}`
                        : 'Area not available';
            const timestamp = document.createElement('time');
            timestamp.className = 'incident-report-time';
            timestamp.dateTime = report.timestamp || '';
            timestamp.textContent = formatReportDate(report.timestamp);

            card.append(header, issue, location, timestamp);
            incidentReportsContainer.appendChild(card);
        });
    };

    const formatReportDate = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? 'Date unavailable'
            : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    };

    const initializeIncidentReports = async () => {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) {
            console.error('Unable to verify collection personnel session:', error);
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Unable to verify your account.</p>';
            return;
        }
        if (!user?.email) {
            incidentReportsContainer.innerHTML = '<p class="section-message error-message">Sign in to view your incident reports.</p>';
            return;
        }

        activeCollectorEmail = user.email;
        await loadIncidentReports();

        const reportChannel = supabase.channel(`collector-reports-${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'reports',
                filter: `collector=eq.${user.email}`
            }, loadIncidentReports)
            .subscribe(status => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error(`Incident report realtime subscription failed: ${status}`);
                }
            });

        window.addEventListener('pagehide', () => {
            supabase.removeChannel(reportChannel);
        }, { once: true });
    };

    initializeIncidentReports();

    function renderBinDetail(bin) {
        const reading = getBinReading(bin);
        displayBinID.textContent = `BIN #${bin.id.replace(/^bin_/, '')}`;
        displayStatus.textContent = reading.label;
        displayFill.textContent = reading.fill;
        statusIndicator.style.color = reading.color;
    }

    function showDetail(binId) {
        const bin = allBins[binId];
        if (!bin) return;

        activeBinId = binId;
        renderBinDetail(bin);
        binSelectionView.style.display = 'none';
        binDetailView.style.display = 'block';
        backBtn.setAttribute('aria-label', 'Back to bin list');
        backBtn.hidden = false;
    }

    /**
     * 4. SEARCH LOGIC
     */
    binSearch.addEventListener('input', (e) => {
        renderBins(allBins, e.target.value);
    });

        /**
     * INCIDENT ERROR (below the selection) & RESULT POP-UP
     */
    const incidentError = document.getElementById('incidentError');

    function showIncidentError(message) {
        incidentError.textContent = message;
        incidentError.style.display = 'block';
    }

    function clearIncidentError() {
        incidentError.textContent = '';
        incidentError.style.display = 'none';
    }

    // Hide the error as soon as an option is picked
    document.querySelectorAll('input[name="issue"]').forEach(el => {
        el.addEventListener('change', clearIncidentError);
    });

    function showReportAlert(type, title, message) {
        const modal = document.getElementById('reportAlert');
        const box = modal.querySelector('.alert-box');
        const icon = document.getElementById('reportAlertIcon');
        const btn = document.getElementById('reportAlertClose');

        box.classList.toggle('error', type === 'error');
        icon.innerHTML = type === 'error'
            ? '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>'
            : '<svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"></polyline></svg>';
        document.getElementById('reportAlertTitle').textContent = title;
        document.getElementById('reportAlertMessage').textContent = message;

        modal.classList.add('show');
        btn.onclick = () => modal.classList.remove('show');
    }

    /**
     * 5. SUBMIT INCIDENT REPORT & NOTIFY CITIZENS
     */
    submitUpdateBtn.addEventListener('click', async () => {
        const selected = document.querySelector('input[name="issue"]:checked');
                if (!selected) {
            showIncidentError('Please select an incident before submitting');
            return;
        }
        clearIncidentError();

        const binKey = activeBinId;
        if (binKey === null) return;
        let issueText = selected ? selected.value : "Routine Checkup";
        if (issueText === "Others") {
            const otherInput = document.getElementById('otherIssueInput');
            issueText = otherInput ? otherInput.value : "Other Unspecified Issue";
        }

        try {
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;
            if (!user?.email) throw new Error('You must be signed in to submit an incident report.');

            // Fetch bin data to get the barangay
            const { data: binData, error: binError } = await supabase.from('bins').select('barangay').eq('id', binKey).single();
            if (binError) console.error("Unable to load reported bin location:", binError);
            const binBarangay = binData ? binData.barangay : "Global";

            // 1. Submit detailed report[cite: 8]
            const { error: reportError } = await supabase.from('reports').insert({
                bin_id: binKey,
                issue: issueText,
                timestamp: new Date().toISOString(),
                collector: user.email
            });
            if (reportError) throw reportError;
            await loadIncidentReports();

            // 2. TRIGGER CITIZEN NOTIFICATION
            let customMessage = `Collector reported "${issueText}" for ${binKey.replace('bin_', 'Bin #')}`;
            let notifType = "warning"; 

            // Use .includes() to be safer if the text varies slightly
            if (issueText.includes("Overflowing")) {
                customMessage = `Your ${binKey.replace('bin_', 'Bin #')} reported as overflowing, pls monitor and dispose before the bin is full.`;
            } else if (issueText.includes("Damaged")) {
                customMessage = `Be careful using ${binKey.replace('bin_', 'Bin #')}, it has been reported as damaged and is awaiting maintenance.`;
                notifType = "cancellation"; 
            }

            const { error: citizenNotificationError } = await supabase.from('notifications').insert({
                title: "Bin Management Alert",
                message: customMessage,
                barangay: binBarangay, 
                type: notifType,
                status: "unread",
                created_at: new Date().toISOString()
            });
            if (citizenNotificationError) {
                console.error("Bin report filed, but citizen notification could not be created:", citizenNotificationError);
                await writeLog("Bin Reported", `Collection report filed for ${binKey}; citizen notification failed for Brgy. ${binBarangay}.`, "logs");
                                closeDetailView();
                showReportAlert('success', 'Report Filed Successfully!','The report will be reviewed in a few days.');
                return;
            }

            // 3. Log the system action[cite: 8]
            await writeLog("Bin Reported", `Citizen notification sent to Brgy. ${binBarangay} for ${binKey}`, "logs");
            
             
            closeDetailView();
            showReportAlert('success', 'Report Filed Successfully!', `Citizens in Brgy. ${binBarangay} have been notified.`);
        } catch (error) {
            console.error("Update failed:", error);
                        showReportAlert('error', 'Report Failed', 'Error updating bin status. Please try again.');
        }
    });

    /**
     * 6. NAVIGATION HELPERS
     */
    function closeDetailView() {
        activeBinId = null;
        
        binDetailView.style.display = 'none';
        binSelectionView.style.display = 'block';
        backBtn.hidden = true;
        
        document.querySelectorAll('input[name="issue"]').forEach(el => el.checked = false);
        clearIncidentError();
        const otherInput = document.getElementById('otherIssueInput');
        if (otherInput) otherInput.value = "";
    }

    backBtn.addEventListener('click', closeDetailView);

    loadBins();
    const binChannel = supabase.channel('collector-bin-update')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadBins)
        .subscribe(status => {
            if (status === 'SUBSCRIBED') loadBins();
        });
    window.addEventListener('pagehide', event => {
        if (!event.persisted) supabase.removeChannel(binChannel);
    });
});