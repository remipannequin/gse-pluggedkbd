/* eslint-disable no-undef */
/* eslint-disable prefer-arrow-callback */


const ProcInputDevicesPoller = imports.pluggedKbd.ProcInputDevicesPoller;

const KBD1 = 'AT Translated Set 2';
const KBD1_DEV = 'event3';
const KBD1_PHYS = 'isa0060/serio0/input0';

const KBD2 = 'OLKB Planck';
const KBD2_DEV1 = 'event20';
const KBD2_PHYS1 = 'usb-0000:00:14.0-2/input0';

describe('/proc/bus/input/device poller', function () {
    let poller;

    beforeEach(function () {
        poller = new ProcInputDevicesPoller();
        poller._FILE = 'tests/mock-cmd/devices1';
    });

    it('can poll devices1 file', function () {
        poller._poll();
        expect(poller._register.size).toBe(1);
        expect(poller._register.has(KBD1)).toBe(true);
        const dev = poller._register.get(KBD1);
        expect(dev.name).toBe(KBD1);
        expect([...dev.getEventDevices()]).toContain(KBD1_DEV);
        expect(dev.getPhys(KBD1_DEV)).toBe(KBD1_PHYS);
    });

    it('get the detected devices', function () {
        poller._poll();
        expect(poller.getDevice(KBD1)).toBeDefined();
        const dev = poller.getDevice(KBD1);
        expect(dev.name).toBe(KBD1);
    });

    it('display devices in toString()', function () {
        poller._poll();
        const str = poller.toString();
        expect(str).toContain(KBD1);
        expect(str).toContain(KBD1_DEV);
        expect(str).toContain(KBD1_PHYS);
    });

    it('can poll devices2 file', function () {
        poller._FILE = 'tests/mock-cmd/devices2';
        poller._poll();
        expect(poller._register.size).toBe(2);
        expect([...poller._register.keys()]).toContain(KBD1);
        expect([...poller._register.keys()]).toContain(KBD2);
        const dev = poller._register.get(KBD2);
        expect(dev.name).toBe(KBD2);
        expect([...dev.getEventDevices()]).toContain(KBD2_DEV1);
        expect(dev.getPhys(KBD2_DEV1)).toBe(KBD2_PHYS1);
    });

    it('detects when devices are added', function () {
        poller._poll();
        let signalEmitted = false;
        poller.connect('keyboard-added', (p, k) => {
            signalEmitted = true;
            expect(p).toBe(poller);
            expect(k).toBe(KBD2);
            const dev = poller.getDevice(k);
            expect(dev).toBeDefined();
        });
        poller._FILE = 'tests/mock-cmd/devices2';
        poller._poll();
        expect(signalEmitted).toBe(true);
    });

    it('detects when devices are removed', function () {
        poller._FILE = 'tests/mock-cmd/devices2';
        poller._poll();
        let signalEmitted = false;
        poller.connect('keyboard-removed', (p, k) => {
            signalEmitted = true;
            expect(p).toBe(poller);
            expect(k).toBe(KBD2);
        });
        poller._FILE = 'tests/mock-cmd/devices1';
        poller._poll();
        expect(signalEmitted).toBe(true);
        expect(poller._register.size).toBe(1);
    });
});
