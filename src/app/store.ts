/**
 * Explicit Jotai store. We use a stable store object so that callbacks from
 * non-React code (service observers, async download progress, etc.) can write
 * to the same atom graph as React components read.
 */
import { createStore } from 'jotai';

export const appStore = createStore();