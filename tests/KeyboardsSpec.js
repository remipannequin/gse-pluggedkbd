/* eslint-disable no-undef */
/* eslint-disable prefer-arrow-callback */


const Keyboards = imports.pluggedKbd.Keyboards;
const InputDevice  = imports.pluggedKbd.InputDevice;
const KBD1 = 'AT Translated Set 2';
const KBD2 = 'OLKB Planck';
const KBD2_DEV1 = 'event20';
const KBD2_PHYS1 = 'usb-0000:00:14.0-2/input0';

const DATA = [
    [
        'AT Translated Set 2',
        0,
        'AT Translated Set 2',
        'fr+latin9',
    ],
    [
        'OLKB Planck',
        1,
        'Planck',
        'us+altgr-intl',
    ],
    [
        'Input Club Infinity_Ergodox/QMK',
        1,
        'Input Club Infinity Ergodox/QMK',
        'fr+bepo',
    ],
];

class InputSourceMock {
    constructor(name, id) {
        this._id = id;
        this._short = name;
        this._active = false;
    }

    get id() {
        return this._id;
    }

    get shortName() {
        return this._short;
    }

    activate() {
        this._active = true;
    }
}

class InputSourceManagerMock {
    constructor(srcList) {
        this._currentSrc = srcList[0];
        this._sources = srcList;
    }

    get currentSource() {
        return this._currentSrc;
    }

    get inputSources() {
        return this._sources;
    }
}

class PollerMock {
    constructor(dev) {
        this.dev = dev;
    }

    getDevice(id) {
        expect(id).toBe(this.dev.name);
        return this.dev;
    }
}

describe('The keyboards register', function () {
    let kbd;
    let ism;
    let src1, src2;

    beforeEach(function () {
        src1 = new InputSourceMock('fr1', 'fr+latin9');
        src2 = new InputSourceMock('en', 'us+altgr-intl');
        src3 = new InputSourceMock('fr2', 'fr+bepo');
        ism = new InputSourceManagerMock([src1, src2, src3]);
        kbd = new Keyboards(ism);
    });

    it('has default values', function () {
        expect(kbd.current).toBeNull();
        expect(kbd.defaultSource).toBeNull();
        expect(kbd.size()).toBe(0);
    });

    it('accepts a new device', function () {
        const dev = new InputDevice(KBD2);
        dev.addPhys(KBD2_DEV1, KBD2_PHYS1);
        mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD2);
        expect(kbd.size()).toBe(1);
        expect(kbd.has(KBD2)).toBe(true);
        expect(kbd.values()).toBeDefined();
    });

    it('guesses priority of an unknown added keyboard', function () {
        let dev = new InputDevice(KBD1);
        let mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD1);
        expect(kbd.get(KBD1).prio).toBe(0);
        dev = new InputDevice(KBD2);
        mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD2);
        expect(kbd.get(KBD2).prio).toBe(1);
    });

    it('associates an added keyboard to an input source', function () {
        const dev = new InputDevice(KBD2);
        dev.addPhys(KBD2_DEV1, KBD2_PHYS1);
        mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD2);
        let k = kbd.get(KBD2);
        expect(k).toBeDefined();
        kbd.associate(k, src2);
        expect(k.associated).toBe(src2);
        expect(kbd.current).toBeNull();
    });

    it('makes keyboard current when connected, if associated with current source', function () {
        ism._currentSrc = src2;
        kbd.updateCurrentSource();
        const dev = new InputDevice(KBD2);
        dev.addPhys(KBD2_DEV1, KBD2_PHYS1);
        mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD2);
        let k = kbd.get(KBD2);
        expect(k).toBeDefined();
        kbd.associate(k, src2);
        expect(k.associated).toBe(src2);
        expect(kbd.current).toBe(k);
    });

    it('makes keyboard current when source changed, if associated with current source', function () {
        const dev = new InputDevice(KBD2);
        dev.addPhys(KBD2_DEV1, KBD2_PHYS1);
        mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD2);
        let k = kbd.get(KBD2);
        expect(k).toBeDefined();
        kbd.associate(k, src2);
        expect(kbd.current).toBeNull();
        ism._currentSrc = src2;
        kbd.updateCurrentSource();
        expect(kbd.current).toBe(k);
    });

    it('recovers its state from config data', function () {
        let data = [
            ['AT Translated Set 2', 0, 'AT Translated Set 2', 'fr+latin9'],
            ['OLKB Planck', 1, 'Planck', 'us+altgr-intl'],
        ];
        kbd.ruleList = data;
        expect(kbd.size(), 2);
        expect(kbd.has(KBD1)).toBe(true);
        expect(kbd.has(KBD2)).toBe(true);
        expect(kbd.current).toBeNull();
        const dev1 = kbd.get(KBD1);
        expect(dev1.id).toBe(KBD1);
        expect(dev1.prio).toBe(0);
        expect(dev1.connected).toBe(false);
        expect(dev1.associated).toBe(src1);
        const dev2 = kbd.get(KBD2);
        expect(dev2.id).toBe(KBD2);
        expect(dev2.prio).toBe(1);
        expect(dev2.connected).toBe(false);
        expect(dev2.associated).toBe(src2);
    });

    it('accepts a known device, make it current', function () {
        kbd.ruleList = DATA;
        const dev = new InputDevice(KBD1);
        const mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD1);
        expect(kbd.size()).toBe(3);
        const k1 = kbd.get(KBD1);
        expect(k1.prio).toBe(0);
        expect(k1.connected).toBe(true);
        expect(k1.associated).toBe(src1);
        expect(kbd.current).toBe(k1);
    });

    it('changes input source when device is plugged', function () {
        // Load config
        kbd.ruleList = DATA;
        // Add first KB
        let dev = new InputDevice(KBD1);
        let mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD1);
        expect(src2._active).toBe(false);
        // Add second KB
        dev = new InputDevice(KBD2);
        mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD2);
        expect(kbd.size()).toBe(3);
        const k2 = kbd.get(KBD2);
        expect(k2.prio).toBe(1);
        expect(k2.connected).toBe(true);
        expect(kbd.current).toBe(k2);
        expect(src2._active).toBe(true);
    });

    it('respects keyboard priority', function () {
        // Load config
        kbd.ruleList = DATA;
        ism._currentSrc = src2;
        expect(kbd.current).toBeNull();
        // Add second KB
        let dev = new InputDevice(KBD2);
        let mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD2);
        expect(kbd.current.id).toBe(KBD2);
        // Add first KB
        dev = new InputDevice(KBD1);
        mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD1);
        // current should not change
        expect(kbd.current.id).toBe(KBD2);
    });

    it('changes current if keyboard is removed', function () {
        // Load config
        kbd.ruleList = DATA;
        // Add
        let dev = new InputDevice(KBD1);
        let mockedPoller = new PollerMock(dev);
        kbd.add(mockedPoller, KBD1);
        expect(kbd.current.id).toBe(KBD1);
        kbd.remove(mockedPoller, KBD1);
        let k = kbd.get(KBD1);
        expect(k.connected).toBe(false);
        expect(kbd.current).toBeNull();
    });

    it('selects another keyboard when current is unplugged', function () {
        // Load config
        kbd.ruleList = DATA;
        ism._currentSrc = src2;
        // Add second KB
        let dev = new InputDevice(KBD2);
        let mockedPoller1 = new PollerMock(dev);
        kbd.add(mockedPoller1, KBD2);
        // Add first KB
        dev = new InputDevice(KBD1);
        let mockedPoller2 = new PollerMock(dev);
        kbd.add(mockedPoller2, KBD1);
        expect(kbd.current.id).toBe(KBD2);
        kbd.remove(mockedPoller1, KBD2);
        expect(kbd.current.id).toBe(KBD1);
    });
});
