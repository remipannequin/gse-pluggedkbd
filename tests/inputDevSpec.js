/* eslint-disable no-undef */
/* eslint-disable prefer-arrow-callback */

const {GLib} = imports.gi;

const InputDevice = imports.pluggedKbd.InputDevice;

const KBD_NAME_1 = 'Example Manufacturer Wonderfull_Shiny/Keyboard';
const KBD_NAME_2 = 'Example Manufacturer Wonderfull Shiny/Keyboard';

// Prepare GLib to call mock udev-adm instead of real one
GLib.setenv('PATH', 'tests/mock-cmd', true);


describe('An input device', function () {
    let dev;

    beforeEach(function () {
        dev = new InputDevice(KBD_NAME_1);
    });

    it('has a name', function () {
        expect(dev.name).toBe(KBD_NAME_1);
    });

    it('has a display name', function () {
        expect(dev.displayName).toBe(KBD_NAME_2);
    });

    it('has no physical dev initialy', function () {
        expect(dev._devices.size).toBe(0);
    });

    it('can be associated to a device', function () {
        dev.addPhys('event3', 'testtesttest');
        expect(dev._devices.size).toBe(1);
        expect(dev._devices.has('event3')).toBe(true);
        expect(dev._devices.get('event3')).toBe('testtesttest');
        expect(dev.displayName).toBe(KBD_NAME_2);
        expect(dev._isDefaultName).toBe(true);
    });

    it('update display name if udevadm give model name', function () {
        dev.addPhys('event3', 'testtesttest');
        dev.addPhys('event20', 'testtesttest2');
        expect(dev._devices.size).toBe(2);
        expect(dev._devices.has('event20')).toBe(true);
        expect(dev._devices.get('event20')).toBe('testtesttest2');
        expect(dev.displayName).toBe('Planck');
    });

    it('can get event devices associated', function () {
        dev.addPhys('event3', 'testtesttest');
        dev.addPhys('event20', 'testtesttest2');
        expect([...dev.getEventDevices()]).toContain('event3');
        expect([...dev.getEventDevices()]).toContain('event20');
        expect(dev.getPhys('event3')).toBe('testtesttest');
        expect(dev.getPhys('event20')).toBe('testtesttest2');
    });
});
