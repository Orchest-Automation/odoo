import { click, contains, defineMailModels, start } from "@mail/../tests/mail_test_helpers";
import { describe, test } from "@odoo/hoot";
import { mountWithCleanup } from "@web/../tests/web_test_helpers";

import { Avatar } from "@mail/views/web/fields/avatar/avatar";

describe.current.tags("desktop");
defineMailModels();

test("basic rendering", async () => {
    await start();
    await mountWithCleanup(Avatar, {
        props: {
            resId: 2,
            resModel: "res.users",
            displayName: "User display name",
        },
    });
    await contains(".o-mail-Avatar");
    await contains(".o-mail-Avatar img");
    await contains(".o-mail-Avatar img[data-src='/web/image/res.users/2/avatar_128']");
    await contains(".o-mail-Avatar span");
    await contains(".o-mail-Avatar span", { text: "User display name" });
    await contains(".o-mail-ChatWindow", { count: 0 });
    await click(".o-mail-Avatar img");
    await contains(".o-mail-ChatWindow");
});
