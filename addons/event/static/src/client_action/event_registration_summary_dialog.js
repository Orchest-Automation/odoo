/** @odoo-module **/

import { Component, onMounted, useState, useRef } from "@odoo/owl";
import { isBarcodeScannerSupported } from "@web/webclient/barcode/barcode_scanner";
import { Dialog } from "@web/core/dialog/dialog";
import { useService } from "@web/core/utils/hooks";
import { browser } from "@web/core/browser/browser";
import { uuid } from "@web/views/utils";
import { _t } from "@web/core/l10n/translation";

const IOT_BOX_PING_TIMEOUT_MS = 1000;
const PRINT_SETTINGS_LOCAL_STORAGE_KEY = "event.registration_print_settings";
const DEFAULT_PRINT_SETTINGS = {
    autoPrint: false,
    iotPrinterId: null
};

export class EventRegistrationSummaryDialog extends Component {
    static template = "event.EventRegistrationSummaryDialog";
    static components = { Dialog };
    static props = {
        close: Function,
        doNextScan: Function,
        playSound: Function,
        registration: Object,
    };

    setup() {
        this.actionService = useService("action");
        this.isBarcodeScannerSupported = isBarcodeScannerSupported();
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.continueButtonRef = useRef("continueButton");

        this.registrationStatus = useState({value: this.registration.status});
        const storedPrintSettings = browser.localStorage.getItem(PRINT_SETTINGS_LOCAL_STORAGE_KEY);
        this.printSettings = useState(storedPrintSettings ? JSON.parse(storedPrintSettings) : DEFAULT_PRINT_SETTINGS);
        this.useIotPrinter = this.registration.iot_printers.length > 0;

        if (this.useIotPrinter && !this.registration.iot_printers.map(printer => printer.id).includes(this.printSettings.iotPrinterId)) {
            this.printSettings.iotPrinterId = null;
        }

        if (this.registration.iot_printers.length === 1) {
            this.printSettings.iotPrinterId = this.registration.iot_printers[0].id;
        }

        onMounted(() => {
            if (this.props.registration.status === 'already_registered' || this.props.registration.status === 'need_manual_confirmation') {
                this.props.playSound("notify");
            } else if (this.props.registration.status === 'not_ongoing_event' || this.props.registration.status === 'canceled_registration') {
                this.props.playSound("error");
            } else if (this.props.registration.status === 'confirmed_registration' && this.printSettings.autoPrint && this.useIotPrinter && this.hasSelectedPrinter()) {
                this.onRegistrationPrintPdf();
            }
            // Without this, repeat barcode scans don't work as focus is lost
            this.continueButtonRef.el.focus();
        });
    }

    get registration() {
        return this.props.registration;
    }

    get selectedPrinter() {
        return this.registration.iot_printers.find(printer => printer.id === this.printSettings.iotPrinterId);
    }

    get needManualConfirmation() {
        return this.registrationStatus.value === "need_manual_confirmation";
    }

    async onRegistrationConfirm() {
        await this.orm.call("event.registration", "action_set_done", [this.registration.id]);
        this.registrationStatus.value = "confirmed_registration";
    }

    async onRegistrationPrintPdf() {
        if (this.useIotPrinter && this.printSettings.iotPrinterId) {
            await this.printWithBadgePrinter();
        } else {
            this.actionService.doAction({
                type: "ir.actions.report",
                report_type: "qweb-pdf",
                report_name: `event.event_registration_report_template_badge/${this.registration.id}`,
            });
        }
    }

    async onRegistrationView() {
        await this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: "event.registration",
            res_id: this.registration.id,
            views: [[false, "form"]],
            target: "current",
        });
        this.props.close();
    }

    async onScanNext() {
        this.props.close();
        if (this.isBarcodeScannerSupported) {
            this.props.doNextScan();
        }
    }

    hasSelectedPrinter() {
        return !this.useIotPrinter || this.printSettings.iotPrinterId != null;
    }

    savePrintSettings() {
        browser.localStorage.setItem(PRINT_SETTINGS_LOCAL_STORAGE_KEY, JSON.stringify(this.printSettings));
    }

    async isIotBoxReachable() {
        const timeoutController = new AbortController();
        setTimeout(() => timeoutController.abort(), IOT_BOX_PING_TIMEOUT_MS);
        const iotBoxUrl = this.selectedPrinter?.ipUrl;

        try {
            const response = await browser.fetch(`${iotBoxUrl}/hw_proxy/hello`, { signal: timeoutController.signal });
            return response.ok;
        } catch {
            return false;
        }
    }

    async printWithLongpolling(reportId) {
        try {
            const [[ip, identifier,, printData]] = await this.orm.call("ir.actions.report", "render_and_send", [
                reportId,
                [this.selectedPrinter],
                [this.registration.id],
                null,
                null,
                false, // Do not use websocket
            ]);
            const payload = { document: printData, print_id: uuid() }
            const { result } = await this.env.services.iot_longpolling.action(ip, identifier, payload, true);
            return result;
        } catch {
            return false;
        }
    }

    async printWithBadgePrinter() {
        const reportName = `event.event_report_template_esc_label_${this.registration.badge_format}_badge`;
        const [{ id: reportId }] = await this.orm.searchRead("ir.actions.report", [["report_name", "=", reportName]], ["id"]);

        this.notification.add(_t("Printing badge on %s...", this.selectedPrinter.name), { type: "info" })
        if (await this.isIotBoxReachable()) {
            const printSuccessful = await this.printWithLongpolling(reportId);
            if (printSuccessful) {
                return;
            }
        }
        const printJobArguments = [reportId, [this.registration.id], null, uuid()];
        await this.env.services.iot_websocket.addJob([this.printSettings.iotPrinterId], printJobArguments);
    }
}
