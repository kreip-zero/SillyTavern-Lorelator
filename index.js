import { initPanel } from './src/ui/panel.js';
import { initActivationView } from './src/ui/activation-view.js';

jQuery(async () => {
    try {
        await initPanel();
        initActivationView();
    } catch (error) {
        console.error('[Lorelator] failed to start', error);
    }
});
