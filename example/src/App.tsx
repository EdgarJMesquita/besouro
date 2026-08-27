import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { io, type Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsStorage, storage } from './store/mmkv';
import { useMMKVBoolean } from 'react-native-mmkv';
import * as Notifications from 'expo-notifications';
import notifee, { AndroidImportance } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { create } from 'zustand';
import { File, Paths } from 'expo-file-system';
import { reloadAppAsync } from 'expo';
import { getDefaultStore } from 'jotai';
import { cartAtom, counterAtom, statusAtom } from './store/atoms';
import {
  fetchTodos,
  increment as reduxIncrement,
  reset as reduxReset,
  setLabel as reduxSetLabel,
  store as reduxStore,
} from './store/redux';

interface CounterState {
  count: number;
  label: string;
  increment: () => void;
  setLabel: (label: string) => void;
  reset: () => void;
}

export const useCounterStore = create<CounterState>((set) => ({
  count: 0,
  label: 'idle',
  increment: () => set((state) => ({ count: state.count + 1 })),
  setLabel: (label) => set({ label }),
  reset: () => set({ count: 0, label: 'idle' }),
}));

// Let expo-notifications show banners while the app is in the foreground so we
// can verify that the native inspector captures them.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

if (true) {
  // Decide whether to load the devtools based on your own criteria (e.g. __DEV__).
  require('./tools/besouro');
}

// The local echo server (scripts/socketio-server) listens on :4001. The iOS
// simulator reaches the host via localhost; the Android emulator via 10.0.2.2.
// On a physical device, replace this with your machine's LAN IP.
const SOCKETIO_URL = Platform.select({
  ios: 'http://localhost:4001',
  android: 'http://10.0.2.2:4001',
  default: 'http://localhost:4001',
});

export default function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const socketioRef = useRef<Socket | null>(null);
  const reduxState = useSyncExternalStore(
    reduxStore.subscribe,
    reduxStore.getState
  );
  const count = useCounterStore((state) => state.count);
  const label = useCounterStore((state) => state.label);
  // Deliberately *without* an instance argument, which is the case worth
  // exercising: the hook then writes through react-native-mmkv's own default
  // instance — a different JS object from the `storage` we registered with
  // `mmkv`, backed by the same store. On v4 the change notification
  // is a process-wide registry keyed by the store's id, so the inspector's
  // listener on `storage` still sees the write and logs it under `default`
  // (as an inferred `set`/`remove`, since a listener is handed only a key).
  const [hookEnabled, setHookEnabled] = useMMKVBoolean('hook.enabled');

  useEffect(() => {
    Notifications.requestPermissionsAsync();
  }, []);

  const triggerFetch = () => {
    console.log(
      'GET https://jsonplaceholder.typicode.com/todos/1?hello=world&foo=bar'
    );
    fetch('https://jsonplaceholder.typicode.com/todos/1?hello=world&foo=bar')
      .then((response) => response.json())
      .then((body) => console.log('fetch ok', body))
      .catch((error) => console.warn('fetch failed', error));
  };

  const triggerError = () => {
    console.error('Simulated error with details', { code: 500 });
    fetch('https://example.com/does-not-exist-404').catch(() => {});
  };

  // Throws from a timer callback rather than inline, so nothing in the render
  // path or an enclosing try/catch can swallow it — it goes straight to
  // ErrorUtils' global handler and should land in the Console tab as UNCAUGHT.
  const triggerUncaughtError = () => {
    setTimeout(() => {
      throw new Error('Uncaught error from a timer callback');
    }, 0);
  };

  // The non-Error path: RN wraps this in a SyntheticError before reporting, so
  // the captured event has a message but no stack.
  const triggerUncaughtString = () => {
    setTimeout(() => {
      throw 'uncaught string, not an Error';
    }, 0);
  };

  const openSocket = () => {
    const socket = new WebSocket('wss://ws.postman-echo.com/raw');
    socketRef.current = socket;
    socket.onopen = () => socket.send('hello from the example app');
    socket.onmessage = (event) => console.log('ws message', event.data);
  };

  const connectSocketIO = () => {
    // First tap: connect + instrument. RN works best on the websocket transport
    // (skips the XHR-polling handshake). attachSocketIO must run before emit so
    // outgoing frames are captured.
    if (!socketioRef.current) {
      // No attach call needed — socketIO(Manager) already patched the
      // factory, so this socket is captured the moment io() creates it.
      const socket = io(SOCKETIO_URL, { transports: ['websocket'] });
      socketioRef.current = socket;
      socket.on('welcome', (data) => console.log('sio welcome', data));
      socket.on('pong', (data) => console.log('sio pong', data));
      socket.on('connect', () => {
        console.log('sio connected', socket.id);
        socket.emit('ping', { hello: 'from example' }, (ack: unknown) =>
          console.log('sio ack', ack)
        );
      });
      return;
    }
    // Subsequent taps: emit another ping (with an ack callback) to generate more
    // send/receive frames in the inspector.
    socketioRef.current.emit('ping', { at: Date.now() }, (ack: unknown) =>
      console.log('sio ack', ack)
    );
  };

  const disconnectSocketIO = () => {
    socketioRef.current?.disconnect();
    socketioRef.current = null;
  };

  const scheduleNotification = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Scheduled notification',
        body:
          'This was triggered from the example app at ' +
          new Date().toLocaleTimeString(),
        data: { source: 'example', timestamp: Date.now() },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
      },
    });
    console.log('Notification scheduled for 2 seconds from now');
  };

  const displayNotifee = async () => {
    await notifee.requestPermission();
    // Android requires a channel before a notification can be displayed.
    const channelId = await notifee.createChannel({
      id: 'default',
      name: 'Default Channel',
      importance: AndroidImportance.HIGH,
    });
    await notifee.displayNotification({
      title: 'Notifee notification',
      body: 'Displayed via notifee at ' + new Date().toLocaleTimeString(),
      data: { source: 'notifee', timestamp: Date.now() },
      android: { channelId, pressAction: { id: 'default' } },
    });
    console.log('Notifee notification displayed');
  };

  const getFcmToken = async () => {
    try {
      await messaging().requestPermission();
      const token = await messaging().getToken();
      console.log('FCM token', token);
    } catch (error) {
      console.warn('FCM token failed', error);
    }
  };

  const downloadImage = async () => {
    try {
      const destination = new File(Paths.document, `sample-${Date.now()}.png`);
      const file = await File.downloadFileAsync(
        'https://reactnative.dev/img/tiny_logo.png',
        destination
      );
      console.log('Image downloaded to', file.uri);
    } catch (error) {
      console.warn('Image download failed', error);
    }
  };

  const fetchImage = async () => {
    try {
      const response = await fetch('https://reactnative.dev/img/tiny_logo.png');
      console.log('Image downloaded', response.type, response.status);
    } catch (error) {
      console.warn('Image download failed', error);
    }
  };

  // Exercises the Response tab's HTML preview: a text/html body the panel can
  // render as a page instead of as markup.
  const fetchHtml = async () => {
    try {
      const response = await fetch('https://example.com/');
      console.log('HTML fetched', response.headers.get('content-type'));
    } catch (error) {
      console.warn('HTML fetch failed', error);
    }
  };

  const writeStorage = async () => {
    await AsyncStorage.setItem('example:lastTap', new Date().toISOString());
    await AsyncStorage.setItem(
      'example:count',
      String(Math.floor(Math.random() * 100))
    );
    console.log('AsyncStorage written');
  };

  const resetAsyncStorage = async () => {
    await AsyncStorage.removeItem('example:lastTap');
    await AsyncStorage.removeItem('example:count');
    console.log('AsyncStorage reseted');
  };

  // MMKV is synchronous — no await anywhere, which is half the reason apps reach
  // for it, and why the inspector records no duration for these.
  const writeMmkv = () => {
    storage.set('session.token', `token-${Math.floor(Math.random() * 1000)}`);
    storage.set('session.expiresIn', 3600);
    // Objects go in as JSON strings: MMKV stores strings, numbers, booleans and
    // buffers, so this is the shape the JSON viewer actually gets handed.
    storage.set(
      'user.profile',
      JSON.stringify({ id: 7, name: 'Ada', admin: true })
    );
    // A second instance, so the tab has two to keep apart.
    settingsStorage.set('theme', 'dark');
    settingsStorage.set('analytics.enabled', false);
    console.log('MMKV written');
  };

  const removeMmkvKey = () => {
    storage.remove('session.token');
    console.log('MMKV key removed');
  };

  // Worth tapping after a write: on v2/v3 this is captured as one `clearAll` row,
  // while a v4 instance that refused the patch reports it as one removal per key.
  const clearMmkv = () => {
    storage.clearAll();
    console.log('MMKV cleared');
  };

  // const [showJsxError, setShowJsxError] = useState(false);

  const triggerManyConsoleLogs = async () => {
    const limit = 200;
    const interval = 1000;
    for (let i = 0; i < limit; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, interval));
      console.log(`Console log:', ${i}, at:${new Date().toLocaleDateString()}`);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <View style={styles.container}>
        {/* {showJsxError && (
          <Unknown style={{ color: 'red' }}>
            This is a faulty JSX element that will cause a runtime error because
            it is not closed properly
          </Unknown>
        )} */}
        <Text style={styles.title}>besouro</Text>
        <Button title="Trigger a fetch" onPress={triggerFetch} />
        <Button title="Trigger an error" onPress={triggerError} />
        <Button title="Fetch image" onPress={fetchImage} />
        <Button title="Fetch HTML page" onPress={fetchHtml} />
        <Button
          title="Trigger many console logs"
          onPress={triggerManyConsoleLogs}
        />
        <Button title="Trigger uncaught error" onPress={triggerUncaughtError} />
        <Button
          title="Trigger uncaught string"
          onPress={triggerUncaughtString}
        />
        <Button title="Open a WebSocket" onPress={openSocket} />
        <Button title="Socket.IO: connect & emit" onPress={connectSocketIO} />
        <Button title="Socket.IO: disconnect" onPress={disconnectSocketIO} />
        <Button
          title="Schedule notification (+2s)"
          onPress={scheduleNotification}
        />
        {/* <Button title="Crash JS" onPress={() => setShowJsxError(true)} /> */}
        <Button title="Display notifee notification" onPress={displayNotifee} />
        <Button title="Firebase: get FCM token" onPress={getFcmToken} />
        <Button title="Write AsyncStorage" onPress={writeStorage} />
        <Button title="Reset AsyncStorage" onPress={resetAsyncStorage} />
        <Button title="Download image to sandbox" onPress={downloadImage} />
        <Button title="MMKV: write values" onPress={writeMmkv} />
        <Button title="MMKV: remove a key" onPress={removeMmkvKey} />
        <Button title="MMKV: clear all" onPress={clearMmkv} />
        <Text
          style={styles.hint}
        >{`MMKV hook — hook.enabled: ${String(hookEnabled)}`}</Text>
        <Button
          title="MMKV: toggle via useMMKVBoolean"
          onPress={() => setHookEnabled((current) => !current)}
        />
        <Text
          style={styles.hint}
        >{`Zustand store — count: ${count}, label: ${label}`}</Text>
        <Button
          title="Zustand: increment"
          onPress={() => useCounterStore.getState().increment()}
        />
        <Button
          title="Zustand: set label"
          onPress={() =>
            useCounterStore.getState().setLabel(new Date().toLocaleTimeString())
          }
        />
        <Button
          title="Zustand: reset"
          onPress={() => useCounterStore.getState().reset()}
        />
        <Text
          style={styles.hint}
        >{`Redux store — counter: ${reduxState.counter.value}, todos: ${reduxState.todos.status}`}</Text>
        <Button
          title="Redux: increment"
          onPress={() => reduxStore.dispatch(reduxIncrement())}
        />
        <Button
          title="Redux: set label"
          onPress={() =>
            reduxStore.dispatch(reduxSetLabel(new Date().toLocaleTimeString()))
          }
        />
        {/* The one that matters: `pending` and `fulfilled` are dispatched from
            inside middleware, so they only show up because capture wraps the
            reducer rather than patching `store.dispatch`. */}
        <Button
          title="Redux: async thunk (fetch todos)"
          onPress={() => reduxStore.dispatch(fetchTodos())}
        />
        <Button
          title="Redux: reset"
          onPress={() => reduxStore.dispatch(reduxReset())}
        />
        <Text style={styles.hint}>Jotai atoms</Text>
        <Button
          title="Jotai: increment counter"
          onPress={() => {
            const store = getDefaultStore();
            store.set(counterAtom, store.get(counterAtom) + 1);
          }}
        />
        <Button
          title="Jotai: set status"
          onPress={() =>
            getDefaultStore().set(statusAtom, new Date().toLocaleTimeString())
          }
        />
        {/* Writing `cart` also moves the derived `cartCount`, so both atoms
            record a change from one tap. */}
        <Button
          title="Jotai: add to cart"
          onPress={() => {
            const store = getDefaultStore();
            const cart = store.get(cartAtom);
            store.set(cartAtom, {
              items: [...cart.items, `SKU-${cart.items.length + 1}`],
              total: cart.total + 10,
            });
          }}
        />
        <Text style={styles.hint}>Tap the bug bubble to open Besouro.</Text>
        <Button title="Reload" onPress={() => reloadAppAsync()} />
        <View
          style={{
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 6,
            backgroundColor: '#d2d2d2',
            borderRadius: 12,
          }}
        >
          <View style={{ backgroundColor: '#f0f0f0', padding: 14, margin: 12 }}>
            <Text
              style={{
                color: 'black',
                textAlign: 'center',
                padding: 6,
                backgroundColor: '#a1a1a1',
              }}
            >
              Inspect me
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 64,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  hint: {
    fontSize: 12,
    color: '#888',
  },
});
