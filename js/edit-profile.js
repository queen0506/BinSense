import { supabase } from './supabase-init.js';
import { fillAddressForm, readAddressForm, saveCitizenAddress, detectCurrentLocation } from './citizen-address.js';

async function writeLog(action, message) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('system_logs').insert([{
        email: user.email,
        role: localStorage.getItem('userRole') || 'citizen',
        action,
        message,
        category: 'logs',
        timestamp: new Date().toISOString()
    }]);
}

document.addEventListener('DOMContentLoaded', async () => {
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.onclick = () => window.location.href = 'menu.html';

    const form = document.getElementById('edit-account-form');
    const toast = document.getElementById('toast');
    const nameDisplay = document.getElementById('current-user-name');
    const updateButton = document.getElementById('update-profile-btn');
    const locationButton = document.getElementById('update-location-btn');
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    const nameInput = document.getElementById('fullName');
    const emailInput = document.getElementById('emailAddress');
    emailInput.value = user.email || '';

    const { data: profile } = await supabase
        .from('users')
        .select('name, barangay, house_number, street_name, city_municipality, province, postal_code')
        .eq('id', user.id)
        .maybeSingle();

    const displayName = profile?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
    nameDisplay.textContent = displayName;
    nameInput.value = displayName;
    fillAddressForm({
        houseNumber: profile?.house_number || '',
        streetName: profile?.street_name || '',
        barangay: profile?.barangay || '',
        cityMunicipality: profile?.city_municipality || '',
        province: profile?.province || '',
        postalCode: profile?.postal_code || ''
    });

    function showNotification(message, isError = false) {
        toast.textContent = message;
        toast.classList.toggle('error', isError);
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }

    locationButton?.addEventListener('click', () => {
        locationButton.disabled = true;
        locationButton.textContent = 'Detecting location...';
        detectCurrentLocation(state => {
            if (state.type === 'detected') {
                fillAddressForm(state.address);
                showNotification(state.message);
            } else if (state.type === 'request') {
                showNotification('Waiting for location permission...');
            } else {
                showNotification(state.message, true);
            }
            if (state.type !== 'detecting' && state.type !== 'request') {
                locationButton.disabled = false;
                locationButton.innerHTML = '<span aria-hidden="true">&#8982;</span> Update My Location';
            }
        });
    });

    form?.addEventListener('submit', async event => {
        event.preventDefault();
        const address = readAddressForm();
        updateButton.disabled = true;
        updateButton.textContent = 'Saving...';
        try {
            const newName = nameInput.value.trim();
            const { error: authError } = await supabase.auth.updateUser({ data: { full_name: newName } });
            if (authError) throw authError;

            const { error: dbError } = await supabase.from('users').upsert({
                id: user.id,
                email: user.email,
                name: newName,
                barangay: address.barangay,
                house_number: address.houseNumber,
                street_name: address.streetName,
                city_municipality: address.cityMunicipality,
                province: address.province,
                postal_code: address.postalCode,
                address_confirmed: true,
                address_confirmed_at: new Date().toISOString(),
                role: localStorage.getItem('userRole') || 'citizen'
            }, { onConflict: 'id' });
            if (dbError) throw dbError;

            await writeLog('Profile Update', `User updated name and confirmed address in ${address.barangay}`);
            showNotification('Information updated successfully!');
            setTimeout(() => window.location.href = 'menu.html', 1200);
        } catch (error) {
            console.error('Update Error:', error);
            showNotification('Failed to update: ' + error.message, true);
        } finally {
            updateButton.disabled = false;
            updateButton.textContent = 'Update Information';
        }
    });
});
