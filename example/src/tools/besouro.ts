import { Besouro } from 'besouro';
import { Manager } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import notifee from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { useCounterStore } from '../App';
import { rootReducer, store as reduxStore } from '../store/redux';
import { settingsStorage, storage } from '../store/mmkv';
import { getDefaultStore } from 'jotai';
import {
  cartAtom,
  cartCountAtom,
  counterAtom,
  statusAtom,
} from '../store/atoms';

// network, console, websocket, element and fileSystem need nothing from us, so
// they are already on. The seven below cannot observe anything without the module,
// stores or instances they are given here.
Besouro.configure()
  .socketIO(Manager)
  .asyncStorage(AsyncStorage)
  .notifications({
    expoNotifications: Notifications,
    firebaseMessaging: messaging,
    notifee,
  })
  // A map, unlike AsyncStorage: instances are created by the app, and an app
  // usually has more than one. Writes are captured; reads deliberately are not.
  .mmkv({ default: storage, settings: settingsStorage })
  // Pass the store so its initial state and every transition are captured.
  .zustand({ counter: useCounterStore })
  // The root reducer comes along because capture wraps it — that is what makes the
  // actions `createAsyncThunk` dispatches from inside middleware visible.
  .redux(reduxStore, rootReducer)
  // Atoms are values, not stores — jotai cannot list the ones a store has touched,
  // so the ones worth watching are named here.
  .jotai(getDefaultStore(), {
    counter: counterAtom,
    status: statusAtom,
    cart: cartAtom,
    cartCount: cartCountAtom,
  })
  .init();
