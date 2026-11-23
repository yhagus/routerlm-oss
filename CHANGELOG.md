# v6.2.0 (2026-11-23)

#### Notable changes

**Upgrade**
* Run the 2 new migrations. `20261123100834_window_prices_never_overlap` refuses to run while any Upstream Model has more than one Pricing Window attached, and the error lists those models and their windows. Detach the extra windows in the dashboard, upgrade, then re-attach them, now under the overlap rule below. `20261123102404_window_prices_validity_periods` adds two nullable columns (the Validity Period start and end) and a check that start is before end; existing Window Prices keep no period and stay open-ended – [4293f0b](https://github.com/yhagus/routerlm-oss/commit/4293f0b99c19ccaf046658431f74f2a32138405f), [7330269](https://github.com/yhagus/routerlm-oss/commit/7330269780f5cc2eb4ef3ab25664691666c4a316)
* The order of an Upstream Model's windows (`position`) is gone: Window Prices can no longer apply at once, so there is no "first active window wins". Attachments are listed by start instant, then window name – [4293f0b](https://github.com/yhagus/routerlm-oss/commit/4293f0b99c19ccaf046658431f74f2a32138405f), [b125967](https://github.com/yhagus/routerlm-oss/commit/b12596762cdc29f6fe0762880b1683b3e48c21de)
* The Catalog seed now skips a Catalog-shipped Pricing Window attachment that would overlap one an operator attached, and logs the skip – [5ca97fc](https://github.com/yhagus/routerlm-oss/commit/5ca97fc0d56f1b0dbe1e99f56910838c5d816698), [ff66141](https://github.com/yhagus/routerlm-oss/commit/ff66141bd138c7f085ec0081fbc076c417a3a642)
* Integrations: `ListModels` pricing window entries gain optional `valid_from` and `valid_until` (`google.protobuf.Timestamp`, RFC 3339 in JSON), and entries whose period has ended are left out. Additive; clients that ignore unknown fields need no change – [e97521d](https://github.com/yhagus/routerlm-oss/commit/e97521d8782470c8b7f163fecfa54ec0b2e48b19), [f4717f9](https://github.com/yhagus/routerlm-oss/commit/f4717f96d18b0dba3011baa55093bc0524a0d099)
* Dashboard API: `PUT /upstream-models/:id/pricing-windows` entries accept `validFrom` and `validUntil` (`YYYY-MM-DDTHH:MM` in the window's time zone), and the attachment list adds `validFrom`, `validUntil` and `status` (`scheduled`, `active`, `inactive` or `expired`) and drops `isActiveNow`. The Pricing Windows list keeps `isActiveNow` – [7330269](https://github.com/yhagus/routerlm-oss/commit/7330269780f5cc2eb4ef3ab25664691666c4a316), [b125967](https://github.com/yhagus/routerlm-oss/commit/b12596762cdc29f6fe0762880b1683b3e48c21de), [edd1b8a](https://github.com/yhagus/routerlm-oss/commit/edd1b8a24ca4c0b13f4c13de7d61d3cf2840082f), [6140869](https://github.com/yhagus/routerlm-oss/commit/61408691eac387f25d6f0649946e1cfd7f3e023b)
* No new env variables and no new personal data kept.

**Pricing Windows**
* Window Prices get a Validity Period (an optional start and end), and Cost applies them only within it, the end being exclusive. An attachment with no period is open-ended – [7330269](https://github.com/yhagus/routerlm-oss/commit/7330269780f5cc2eb4ef3ab25664691666c4a316)
* Window Prices on one Upstream Model can no longer apply at the same moment; a save that would overlap is refused – [4293f0b](https://github.com/yhagus/routerlm-oss/commit/4293f0b99c19ccaf046658431f74f2a32138405f)
* The same Pricing Window can be attached to an Upstream Model more than once, with different periods – [7330269](https://github.com/yhagus/routerlm-oss/commit/7330269780f5cc2eb4ef3ab25664691666c4a316), [40687e7](https://github.com/yhagus/routerlm-oss/commit/40687e7359296223b79ab94d9084aa2e99cf1ea2)
* Each attachment shows a status: Scheduled, Active now, Window closed (inside its period but outside the window's hours) or Expired – [7330269](https://github.com/yhagus/routerlm-oss/commit/7330269780f5cc2eb4ef3ab25664691666c4a316), [40687e7](https://github.com/yhagus/routerlm-oss/commit/40687e7359296223b79ab94d9084aa2e99cf1ea2), [edd1b8a](https://github.com/yhagus/routerlm-oss/commit/edd1b8a24ca4c0b13f4c13de7d61d3cf2840082f)

**Catalog**
* The shipped DeepSeek and Alibaba Token Plan Providers now come with their Pricing Windows and Window Prices attached – [5ca97fc](https://github.com/yhagus/routerlm-oss/commit/5ca97fc0d56f1b0dbe1e99f56910838c5d816698)

**Dashboard**
* The Window Prices dialog has period inputs and status badges, shows price changes against the standard price (for example `$0.30 (−50%)`), and no longer has a reorder control – [40687e7](https://github.com/yhagus/routerlm-oss/commit/40687e7359296223b79ab94d9084aa2e99cf1ea2), [edd1b8a](https://github.com/yhagus/routerlm-oss/commit/edd1b8a24ca4c0b13f4c13de7d61d3cf2840082f), [6140869](https://github.com/yhagus/routerlm-oss/commit/61408691eac387f25d6f0649946e1cfd7f3e023b)
* When a new period would overlap an open-ended Window Price, the dialog offers to split that price around it. If the save is then refused, the unsplit prices are kept – [40687e7](https://github.com/yhagus/routerlm-oss/commit/40687e7359296223b79ab94d9084aa2e99cf1ea2), [39eec61](https://github.com/yhagus/routerlm-oss/commit/39eec61145a074aa184145d92263b677ad945fbf)
* The Pricing Window range editor has an "Always" preset – [10c180d](https://github.com/yhagus/routerlm-oss/commit/10c180da696921d4c38cc2b1448ce2e902c614bc)

**Integrations**
* `ListModels` pricing windows carry their Validity Period, so a client can show or schedule upcoming price changes – [e97521d](https://github.com/yhagus/routerlm-oss/commit/e97521d8782470c8b7f163fecfa54ec0b2e48b19), [efe110f](https://github.com/yhagus/routerlm-oss/commit/efe110f3b89bba14b14eb9208334791f797f82ce)

**Other improvements**
* Release pages are titled with the bare version tag – [e8eaf36](https://github.com/yhagus/routerlm-oss/commit/e8eaf368ca97e58b3c0dbb44d7c8d4310a6fa440)

#### Features
* `catalog`
  * [5ca97fc](https://github.com/yhagus/routerlm-oss/commit/5ca97fc0d56f1b0dbe1e99f56910838c5d816698) feat(catalog): ship deepseek and alibaba token plan pricing windows
* `control-plane`
  * [e97521d](https://github.com/yhagus/routerlm-oss/commit/e97521d8782470c8b7f163fecfa54ec0b2e48b19) feat(control-plane): list window prices with validity periods in ListModels
* `pricing-windows`
  * [7330269](https://github.com/yhagus/routerlm-oss/commit/7330269780f5cc2eb4ef3ab25664691666c4a316) feat(pricing-windows): give Window Prices a Validity Period
  * [4293f0b](https://github.com/yhagus/routerlm-oss/commit/4293f0b99c19ccaf046658431f74f2a32138405f) feat(pricing-windows): refuse Window Prices that can apply at once
* `web`
  * [efe110f](https://github.com/yhagus/routerlm-oss/commit/efe110f3b89bba14b14eb9208334791f797f82ce) feat(web): type validity periods on integration pricing windows
  * [40687e7](https://github.com/yhagus/routerlm-oss/commit/40687e7359296223b79ab94d9084aa2e99cf1ea2) feat(web): give window prices validity periods and offer to split
  * [edd1b8a](https://github.com/yhagus/routerlm-oss/commit/edd1b8a24ca4c0b13f4c13de7d61d3cf2840082f) feat(web): mirror window prices status and validity period fields
  * [10c180d](https://github.com/yhagus/routerlm-oss/commit/10c180da696921d4c38cc2b1448ce2e902c614bc) feat(web): add always preset to pricing window ranges

#### Bug fixes
* `pricing-windows`
  * [b125967](https://github.com/yhagus/routerlm-oss/commit/b12596762cdc29f6fe0762880b1683b3e48c21de) fix(pricing-windows): order attachments by start instant, drop isActiveNow
* `web`
  * [39eec61](https://github.com/yhagus/routerlm-oss/commit/39eec61145a074aa184145d92263b677ad945fbf) fix(web): keep unsplit window prices when a split save is refused

#### Refactors
* `db`
  * [6af0d4b](https://github.com/yhagus/routerlm-oss/commit/6af0d4b559018edce1ffe13c3f114f0a19b621c2) refactor(db): share one Transaction type next to Database
* `pricing-windows`
  * [1e2daec](https://github.com/yhagus/routerlm-oss/commit/1e2daecabfa3cf6b75315f3b71a791b977e2039d) refactor(pricing-windows): name window timing types in glossary words
  * [6d41f6e](https://github.com/yhagus/routerlm-oss/commit/6d41f6e339dbb814c8ab34eb224215498ca4f146) refactor(pricing-windows): parse wall clocks once and share time helpers
* `web`
  * [6140869](https://github.com/yhagus/routerlm-oss/commit/61408691eac387f25d6f0649946e1cfd7f3e023b) refactor(web): drop isActiveNow from attached pricing windows
  * [1a74e7e](https://github.com/yhagus/routerlm-oss/commit/1a74e7ec40610b5c0053c63b8e4aba4cc4035e09) refactor(web): read utc offsets with @internationalized/date
  * [86727e5](https://github.com/yhagus/routerlm-oss/commit/86727e5b6d4c4df26ab74955920188995335d96c) refactor(web): type the window prices put body explicitly

#### Docs
* `adr`
  * [5dfc77d](https://github.com/yhagus/routerlm-oss/commit/5dfc77d4e87bf1d515ac92e5246b835646d37e0d) docs(adr): record window closed status and validity period order
  * [eb82e2b](https://github.com/yhagus/routerlm-oss/commit/eb82e2bef677af20d5c90d028e5132ce4b306691) docs(adr): record validity periods and non-overlapping window prices
* `db`
  * [fbb0bd3](https://github.com/yhagus/routerlm-oss/commit/fbb0bd34a694784e6c6d2abb25265ee17d62ca52) docs(db): move the wall-clock column comment to its declaration
* `web`
  * [186e3a2](https://github.com/yhagus/routerlm-oss/commit/186e3a27dc9a13c61f3da3d2061ba7b7a627c925) docs(web): point validity period checks at their backend rules

#### Tests
* `catalog`
  * [ff66141](https://github.com/yhagus/routerlm-oss/commit/ff66141bd138c7f085ec0081fbc076c417a3a642) test(catalog): assert the seed logs skipped Window Prices
* `control-plane`
  * [f4717f9](https://github.com/yhagus/routerlm-oss/commit/f4717f96d18b0dba3011baa55093bc0524a0d099) test(control-plane): give listed Pricing Windows hours that never overlap

#### Build and CI
* `release`
  * [e8eaf36](https://github.com/yhagus/routerlm-oss/commit/e8eaf368ca97e58b3c0dbb44d7c8d4310a6fa440) ci(release): title releases with the bare version tag

**Full Changelog**: https://github.com/yhagus/routerlm-oss/compare/v6.1.0...v6.2.0

# v6.1.0 (2026-11-23)

#### Notable changes

**Upgrade**
* Run the 2 new migrations (`20261123053550_pricing_windows`, `20261123064428_usage_log_pricing_window_name`). They add the `pricing_windows` and `upstream_model_pricing_windows` tables and a nullable `pricing_window_name` column on `usage_logs`; the column has no default, so existing rows are not rewritten – [b257057](https://github.com/yhagus/routerlm-oss/commit/b257057f1eb697e74b24156bfe6a1904db15e6a7), [226fabc](https://github.com/yhagus/routerlm-oss/commit/226fabc182b8199cf0fd7f787054cff044237da7)
* Integrations: `ListModels` (HTTP and gRPC) gains a `pricing_windows` field on each Model, empty when the Model has none. It is additive; clients that ignore unknown fields need no change. The control plane proto adds the `PricingWindow` and `PricingWindowRange` messages – [35bcbbd](https://github.com/yhagus/routerlm-oss/commit/35bcbbd8d533a7eed7447d6bb01adab660432d5c)
* No breaking changes, no new env variables and no new personal data kept: until an operator creates a Pricing Window, Cost is computed as before.

**Pricing Windows**
* A Pricing Window is a named weekly schedule (weekdays and times in one IANA time zone, enabled or disabled) that holds no prices. A new Pricing Windows dashboard page creates, edits, disables and deletes them; deleting one removes its Window Prices from every Upstream Model, disabling keeps them but stops them applying – [b257057](https://github.com/yhagus/routerlm-oss/commit/b257057f1eb697e74b24156bfe6a1904db15e6a7), [b3ba254](https://github.com/yhagus/routerlm-oss/commit/b3ba254ef190f0d6b119f7e5c0123fe167c7bfb5), [23e1d60](https://github.com/yhagus/routerlm-oss/commit/23e1d601b5529fd60e0516e2f34121a27b9907da)
* An Upstream Model attaches windows from its row on the dashboard and gives each its own Window Prices (any of input, output, cache read and cache write; a price left out stays the standard one). Windows keep an order you choose, and the first active enabled window wins. The dialog marks the window in effect – [b257057](https://github.com/yhagus/routerlm-oss/commit/b257057f1eb697e74b24156bfe6a1904db15e6a7), [8810fa1](https://github.com/yhagus/routerlm-oss/commit/8810fa17b36607ab9c89cfa38a89059713caac5e), [e546f54](https://github.com/yhagus/routerlm-oss/commit/e546f5474fbb183ade534854e7945bee2ff6b69a), [61a21d6](https://github.com/yhagus/routerlm-oss/commit/61a21d6d09d758db653239f063b51fcdfb2f9b5e), [3af7ec2](https://github.com/yhagus/routerlm-oss/commit/3af7ec2a18c1f9abd4d81a97ca15dc2f0378ec75)
* Cost at Window Prices: a request is priced at the first active window, decided by when the gateway received it, and the Usage Log records the window's name. A request that asks for a Service Tier ignores windows. The Usage Log detail page shows the window beside the Cost; past Usage Logs keep their Cost and have no window name – [226fabc](https://github.com/yhagus/routerlm-oss/commit/226fabc182b8199cf0fd7f787054cff044237da7), [d7f3e97](https://github.com/yhagus/routerlm-oss/commit/d7f3e97298904a5766d718ab7c4bc1bde8a5eaaf)
* Window edits reach every running instance through the snapshot – [fd733ad](https://github.com/yhagus/routerlm-oss/commit/fd733adfc0190c54d9ca850ad414928bcfaabf23)

**Integrations**
* `ListModels` lists each Model's enabled Pricing Windows (time zone, ranges and the four token prices, with omitted prices filled in with the standard ones), taken from the same Route as the Model's standard prices. The window's name and id are never exposed – [35bcbbd](https://github.com/yhagus/routerlm-oss/commit/35bcbbd8d533a7eed7447d6bb01adab660432d5c)

**Catalog**
* New z.ai Providers: Coding Plan and API – [1955b8f](https://github.com/yhagus/routerlm-oss/commit/1955b8f6aebf5951d4f7726ac4162178ddfe185f)
* New ClinePass Provider, plus a `fixedHeaders` Provider quirk (openai-chat only) that sends fixed request headers with every request to the Provider, editable on the Provider form; they override the client's forwarded headers, and the Provider Account's credential still overrides them – [345c8aa](https://github.com/yhagus/routerlm-oss/commit/345c8aa7c4e28a8092712db882b9b4aa43c93f72)

#### Features
* `catalog`
  * [1955b8f](https://github.com/yhagus/routerlm-oss/commit/1955b8f6aebf5951d4f7726ac4162178ddfe185f) feat(catalog): add z.ai coding plan and api providers
  * [345c8aa](https://github.com/yhagus/routerlm-oss/commit/345c8aa7c4e28a8092712db882b9b4aa43c93f72) feat(catalog): add clinepass provider and a fixed-headers quirk
* `control-plane`
  * [35bcbbd](https://github.com/yhagus/routerlm-oss/commit/35bcbbd8d533a7eed7447d6bb01adab660432d5c) feat(control-plane): list each model's enabled pricing windows with resolved prices
* `pricing-windows`
  * [b257057](https://github.com/yhagus/routerlm-oss/commit/b257057f1eb697e74b24156bfe6a1904db15e6a7) feat(pricing-windows): manage pricing windows and attach window prices
* `snapshot`
  * [fd733ad](https://github.com/yhagus/routerlm-oss/commit/fd733adfc0190c54d9ca850ad414928bcfaabf23) feat(snapshot): load each upstream model's enabled pricing windows
* `usage`
  * [226fabc](https://github.com/yhagus/routerlm-oss/commit/226fabc182b8199cf0fd7f787054cff044237da7) feat(usage): price requests at the first active pricing window and record its name
* `web`
  * [d7f3e97](https://github.com/yhagus/routerlm-oss/commit/d7f3e97298904a5766d718ab7c4bc1bde8a5eaaf) feat(web): show the pricing window beside a usage log's cost
  * [8810fa1](https://github.com/yhagus/routerlm-oss/commit/8810fa17b36607ab9c89cfa38a89059713caac5e) feat(web): manage an upstream model's pricing windows from its row
  * [b3ba254](https://github.com/yhagus/routerlm-oss/commit/b3ba254ef190f0d6b119f7e5c0123fe167c7bfb5) feat(web): add the pricing windows page

#### Bug fixes
* `web`
  * [e546f54](https://github.com/yhagus/routerlm-oss/commit/e546f5474fbb183ade534854e7945bee2ff6b69a) fix(web): mark the pricing window in effect in the pricing windows dialog

#### Refactors
* `general`
  * [2a07219](https://github.com/yhagus/routerlm-oss/commit/2a072190a3f19c3ac369d61517e1cd8993452b43) refactor: replace parent-relative imports with path aliases
* `pricing-windows`
  * [3af7ec2](https://github.com/yhagus/routerlm-oss/commit/3af7ec2a18c1f9abd4d81a97ca15dc2f0378ec75) refactor(pricing-windows): share the attachment select and price types
* `upstream`
  * [61a21d6](https://github.com/yhagus/routerlm-oss/commit/61a21d6d09d758db653239f063b51fcdfb2f9b5e) refactor(upstream): read attached pricing windows through a query

#### Docs
* `general`
  * [23e1d60](https://github.com/yhagus/routerlm-oss/commit/23e1d601b5529fd60e0516e2f34121a27b9907da) docs: define pricing windows and record adr 0038

#### Tests
* `pricing-windows`
  * [1ba29ee](https://github.com/yhagus/routerlm-oss/commit/1ba29ee530942fa498791f0a9390ddd2f6daa086) test(pricing-windows): cover served tiers and playground requests in a window
  * [d19237c](https://github.com/yhagus/routerlm-oss/commit/d19237c40afb3d6031b3c520e4312ae778559cdb) test(pricing-windows): make the noon time zone helper readable
  * [6943918](https://github.com/yhagus/routerlm-oss/commit/6943918a5b8a68f5da46fabc500efff5452480d3) test(pricing-windows): cover migrating a database with existing usage logs
* `snapshot`
  * [b062356](https://github.com/yhagus/routerlm-oss/commit/b062356e9ec62a2e73497231d58c4d52045f1974) test(snapshot): cover a pricing window edit reaching another instance
* `usage`
  * [a40e496](https://github.com/yhagus/routerlm-oss/commit/a40e4964b60aa18492416c2d67c039721b2921ed) test(usage): allow the pricing window name among copied usage log names

#### Chores
* `general`
  * [a61076f](https://github.com/yhagus/routerlm-oss/commit/a61076f5a5ef3ab7c70fedef046fc13684dc70bc) chore: lint nested ternaries, check web type mirrors and clarify checks

**Full Changelog**: https://github.com/yhagus/routerlm-oss/compare/v6.0.0...v6.1.0

# v6.0.0 (2026-11-22)

#### Notable changes

**Upgrade**
* Run the 3 new migrations (`20261121100451_integrations`, `20261121103442_usage_log_transaction_id`, `20261121163726_integration_last_used`). They add the `integrations` and `integration_rotations` tables and Integration, Customer, Spend Limit and Request Rate columns on `api_keys`, `usage_logs` and `attempts`. Adding the identity `sequence` and `transaction_id` columns to `usage_logs` rewrites that table, so allow time on a large one; `transaction_id` uses `xid8` and `pg_current_xact_id()`, which need PostgreSQL 13 or newer – [13730fb](https://github.com/yhagus/routerlm-oss/commit/13730fb512319155dbd2dc77a72199a443e65097), [6f018fb](https://github.com/yhagus/routerlm-oss/commit/6f018fb4265b2fde9f54b8e59a6f14758a923a8b), [c3e1bc7](https://github.com/yhagus/routerlm-oss/commit/c3e1bc71f68c3d3587097624eeefc64cbfb66e3a)
* New optional env variable `CONTROL_PLANE_PORT` (unset by default): when set, the worker serves the control plane over gRPC on that port, in plaintext h2c with no TLS. `deploy/compose.yaml` publishes no port for it; keep it on a private network or behind a TLS proxy, never on the internet – [797f7ce](https://github.com/yhagus/routerlm-oss/commit/797f7cef74cd4f3bbfa63d464c5ea2dfa2a1ad29), [c67287c](https://github.com/yhagus/routerlm-oss/commit/c67287c86ce08a9d89e83d07f39e8976bca3cbad)
* New personal data kept: an Integration's Customer id (its own id for the buyer, nothing else about the Customer) and the Integration's name are stored on API Keys, Usage Logs and Error Captures – [13730fb](https://github.com/yhagus/routerlm-oss/commit/13730fb512319155dbd2dc77a72199a443e65097), [13a73b3](https://github.com/yhagus/routerlm-oss/commit/13a73b30a22e6bea8ddba6be78d341424c27c3df)
* No breaking changes: existing API Keys have no Spend Limit or Request Rate, so they behave as before. The major version marks the size of the Integrations feature.

**Integrations**
* An Integration is an outside application that issues API Keys to its Customers, sets their Spend Limit and Request Rate, and pulls Usage Logs. The dashboard has an Integrations page to create, edit (name and allowed Models), disable, enable and delete one (deleting revokes its API Keys) – [13730fb](https://github.com/yhagus/routerlm-oss/commit/13730fb512319155dbd2dc77a72199a443e65097), [32b05d9](https://github.com/yhagus/routerlm-oss/commit/32b05d96f915dad2b614c07e8d051e2a3e93735a), [759a295](https://github.com/yhagus/routerlm-oss/commit/759a29503ac6e95ec45bc1d8fb3f8f83eaa7e3c8), [04b2e82](https://github.com/yhagus/routerlm-oss/commit/04b2e82406ac9df43349feec22d9fba0596768ba), [373016e](https://github.com/yhagus/routerlm-oss/commit/373016ee7ddc0cc9f408eedbe0092b58a0c432b1), [9370e34](https://github.com/yhagus/routerlm-oss/commit/9370e3489272a19062fc2a6d9329e08bd6657414)
* An Integration Secret (`rlmi_…`) is shown once, can be rotated, and records when it was last used; a new Integration detail page shows its rotations, Customers and Models – [fe00b74](https://github.com/yhagus/routerlm-oss/commit/fe00b74aa01cbbba5ecb91dcd3c76a9560a850da), [c3e1bc7](https://github.com/yhagus/routerlm-oss/commit/c3e1bc71f68c3d3587097624eeefc64cbfb66e3a), [818e521](https://github.com/yhagus/routerlm-oss/commit/818e5216095fde129deaa7c50d54a8a6e8e08f14), [f993fb7](https://github.com/yhagus/routerlm-oss/commit/f993fb7fee3b82f8abc7179e67c0879b6d932e57), [37647f9](https://github.com/yhagus/routerlm-oss/commit/37647f9d977b47624bfb32956ca15cb35f36468c)

**Control plane**
* An Integration issues and manages its Customers' API Keys over HTTP/JSON under `/integration/v1`, authenticated with its Integration Secret as a Bearer token – [c0646f5](https://github.com/yhagus/routerlm-oss/commit/c0646f53cd67709dc1e3af14a6486bf9025fab5f)
* It lists the Models it may sell and pulls Usage Logs after a cursor – [763cdbb](https://github.com/yhagus/routerlm-oss/commit/763cdbbe22abf590be4e94b38c61f09defa68ca5)
* The same operations are served over gRPC by the worker when `CONTROL_PLANE_PORT` is set – [797f7ce](https://github.com/yhagus/routerlm-oss/commit/797f7cef74cd4f3bbfa63d464c5ea2dfa2a1ad29)

**API Keys**
* A key can carry a Spend Limit (at most 10 decimal places); once reached, new requests are refused with `spend_limit_reached`, checked against Postgres before refusing – [901cab2](https://github.com/yhagus/routerlm-oss/commit/901cab2aafb6a6ca81e7483c8c27d5e065281d4d), [c33f504](https://github.com/yhagus/routerlm-oss/commit/c33f5045c1a34719b1b5694b0543c653be7db6df), [37aab3b](https://github.com/yhagus/routerlm-oss/commit/37aab3b4ce34087bc46c479f15a8a6e19394f2f1)
* A key can carry a Request Rate; requests past it are refused with `request_rate_exceeded` only while the key is over its rate – [8960f8d](https://github.com/yhagus/routerlm-oss/commit/8960f8dab821259da52e571417047ad8b3712098), [8d8c484](https://github.com/yhagus/routerlm-oss/commit/8d8c48428dc535f35105273756c659ac04b82661)
* Keys show their owner and limits and can be filtered by Integration and Customer; Customer keys are served by inference and record their Integration – [200bd63](https://github.com/yhagus/routerlm-oss/commit/200bd631e40cc2b49a808748b2f80cfd2e57a615), [743cdae](https://github.com/yhagus/routerlm-oss/commit/743cdae4753956bab6a7a8cb4739cddd4beda965), [dc309b7](https://github.com/yhagus/routerlm-oss/commit/dc309b76684bf0dd855d729125ae76e2c5d585b5)

**Usage Logs and Error Captures**
* Usage Logs and Error Captures return and show the Integration and Customer, and can be filtered by them, including a deleted Integration – [13a73b3](https://github.com/yhagus/routerlm-oss/commit/13a73b30a22e6bea8ddba6be78d341424c27c3df), [6cf0bc3](https://github.com/yhagus/routerlm-oss/commit/6cf0bc3ebb03bcf9d612ecade8229418842bbf43), [e67b2bd](https://github.com/yhagus/routerlm-oss/commit/e67b2bdaa7cf3d66f87777b57b1781a3e3b91c92)
* Each Usage Log records the transaction that wrote it, so pulls by cursor miss none – [6f018fb](https://github.com/yhagus/routerlm-oss/commit/6f018fb4265b2fde9f54b8e59a6f14758a923a8b)

**Catalog**
* New Alibaba Token Plan Provider – [caf5005](https://github.com/yhagus/routerlm-oss/commit/caf5005e289ec6c4e757ee0fc43a3d5fd3489f0f)

#### Features
* `api-keys`
  * [8960f8d](https://github.com/yhagus/routerlm-oss/commit/8960f8dab821259da52e571417047ad8b3712098) feat(api-keys): refuse requests past an api key's request rate
  * [901cab2](https://github.com/yhagus/routerlm-oss/commit/901cab2aafb6a6ca81e7483c8c27d5e065281d4d) feat(api-keys): enforce spend limits counted by the usage worker
  * [200bd63](https://github.com/yhagus/routerlm-oss/commit/200bd631e40cc2b49a808748b2f80cfd2e57a615) feat(api-keys): show and filter keys by integration and customer
* `catalog`
  * [caf5005](https://github.com/yhagus/routerlm-oss/commit/caf5005e289ec6c4e757ee0fc43a3d5fd3489f0f) feat(catalog): add alibaba token plan provider
* `control-plane`
  * [797f7ce](https://github.com/yhagus/routerlm-oss/commit/797f7cef74cd4f3bbfa63d464c5ea2dfa2a1ad29) feat(control-plane): serve the control plane over grpc in the worker
  * [763cdbb](https://github.com/yhagus/routerlm-oss/commit/763cdbbe22abf590be4e94b38c61f09defa68ca5) feat(control-plane): list models and pull usage logs after a cursor
  * [c0646f5](https://github.com/yhagus/routerlm-oss/commit/c0646f53cd67709dc1e3af14a6486bf9025fab5f) feat(control-plane): issue and manage customer api keys over http
* `inference`
  * [dc309b7](https://github.com/yhagus/routerlm-oss/commit/dc309b76684bf0dd855d729125ae76e2c5d585b5) feat(inference): serve customer keys and record their integration
* `integrations`
  * [818e521](https://github.com/yhagus/routerlm-oss/commit/818e5216095fde129deaa7c50d54a8a6e8e08f14) feat(integrations): add detail, rotations, customers and models reads
  * [c3e1bc7](https://github.com/yhagus/routerlm-oss/commit/c3e1bc71f68c3d3587097624eeefc64cbfb66e3a) feat(integrations): record when an integration secret was last used
  * [373016e](https://github.com/yhagus/routerlm-oss/commit/373016ee7ddc0cc9f408eedbe0092b58a0c432b1) feat(integrations): delete an integration, revoking its api keys
  * [04b2e82](https://github.com/yhagus/routerlm-oss/commit/04b2e82406ac9df43349feec22d9fba0596768ba) feat(integrations): disable and enable an integration
  * [fe00b74](https://github.com/yhagus/routerlm-oss/commit/fe00b74aa01cbbba5ecb91dcd3c76a9560a850da) feat(integrations): rotate an integration secret
  * [759a295](https://github.com/yhagus/routerlm-oss/commit/759a29503ac6e95ec45bc1d8fb3f8f83eaa7e3c8) feat(integrations): edit an integration's name and allowed models
  * [32b05d9](https://github.com/yhagus/routerlm-oss/commit/32b05d96f915dad2b614c07e8d051e2a3e93735a) feat(integrations): create and list integrations from the dashboard
  * [13730fb](https://github.com/yhagus/routerlm-oss/commit/13730fb512319155dbd2dc77a72199a443e65097) feat(integrations): add integrations schema, key limits and usage snapshots
* `usage`
  * [13a73b3](https://github.com/yhagus/routerlm-oss/commit/13a73b30a22e6bea8ddba6be78d341424c27c3df) feat(usage): return integration and customer on usage logs and captures
  * [6f018fb](https://github.com/yhagus/routerlm-oss/commit/6f018fb4265b2fde9f54b8e59a6f14758a923a8b) feat(usage): record the transaction that wrote each usage log
* `web`
  * [f993fb7](https://github.com/yhagus/routerlm-oss/commit/f993fb7fee3b82f8abc7179e67c0879b6d932e57) feat(web): add integration detail page
  * [e67b2bd](https://github.com/yhagus/routerlm-oss/commit/e67b2bdaa7cf3d66f87777b57b1781a3e3b91c92) feat(web): name a deleted integration filter pick from its records
  * [6cf0bc3](https://github.com/yhagus/routerlm-oss/commit/6cf0bc3ebb03bcf9d612ecade8229418842bbf43) feat(web): show integration and customer on usage and error captures
  * [743cdae](https://github.com/yhagus/routerlm-oss/commit/743cdae4753956bab6a7a8cb4739cddd4beda965) feat(web): show key owners and limits, filter records by owner
  * [9370e34](https://github.com/yhagus/routerlm-oss/commit/9370e3489272a19062fc2a6d9329e08bd6657414) feat(web): add integrations page to manage integrations

#### Bug fixes
* `api-keys`
  * [c33f504](https://github.com/yhagus/routerlm-oss/commit/c33f5045c1a34719b1b5694b0543c653be7db6df) fix(api-keys): refuse a spend limit with more than 10 decimal places
* `inference`
  * [8d8c484](https://github.com/yhagus/routerlm-oss/commit/8d8c48428dc535f35105273756c659ac04b82661) fix(inference): refuse a key only while it is over its request rate
* `spend-limits`
  * [37aab3b](https://github.com/yhagus/routerlm-oss/commit/37aab3b4ce34087bc46c479f15a8a6e19394f2f1) fix(spend-limits): confirm a reached flag against postgres before refusing

#### Refactors
* `api-keys`
  * [5200a0c](https://github.com/yhagus/routerlm-oss/commit/5200a0ce798eefc69d032baaddbe25b5b3659272) refactor(api-keys): export the spend limit and request rate bounds
* `libs`
  * [7eab54b](https://github.com/yhagus/routerlm-oss/commit/7eab54bf87099bc5d5895d099419deae9d1ddffe) refactor(libs): move the allowed model lookups out of api-keys
* `snapshot`
  * [bbf9586](https://github.com/yhagus/routerlm-oss/commit/bbf9586c32e8fd9910531cc20d9fba02faa565e6) refactor(snapshot): share the check that a route can serve
* `web`
  * [328e03c](https://github.com/yhagus/routerlm-oss/commit/328e03cc574d462b651fb55b4ce1ede3a10ce756) refactor(web): mirror the api key limit bounds from the backend
  * [c4c85e4](https://github.com/yhagus/routerlm-oss/commit/c4c85e4cf4227ce180fca468b7b00b5829de3b00) refactor(web): give shared api key and integration styles neutral names

#### Docs
* `adr`
  * [37ee36b](https://github.com/yhagus/routerlm-oss/commit/37ee36bf3566504606fe1894b2c30e0d5ca53496) docs(adr): say where a single feature's test helpers live
  * [9e5a17a](https://github.com/yhagus/routerlm-oss/commit/9e5a17ad1b7241ab006e830e6d8ad2df64d01715) docs(adr): record the control plane choices the spec left open
  * [159f823](https://github.com/yhagus/routerlm-oss/commit/159f8239f534e3a0940b1088ef7ec597a963fcdd) docs(adr): record integrations control plane decisions
* `deploy`
  * [c67287c](https://github.com/yhagus/routerlm-oss/commit/c67287c86ce08a9d89e83d07f39e8976bca3cbad) docs(deploy): describe CONTROL_PLANE_PORT and the grpc port's exposure
* `web`
  * [5c2bffd](https://github.com/yhagus/routerlm-oss/commit/5c2bffd78e12e22cb36b2965392a39783d5f6937) docs(web): add the Integration control plane page
  * [147b471](https://github.com/yhagus/routerlm-oss/commit/147b4716ba925f8ec3a021a2b4b92b7ba3bd13ee) docs(web): document the request_rate_exceeded error
  * [753fdf6](https://github.com/yhagus/routerlm-oss/commit/753fdf6420c736f24485ddde8f176dadff145158) docs(web): document the spend_limit_reached error

#### Tests
* `api-keys`
  * [450ee9d](https://github.com/yhagus/routerlm-oss/commit/450ee9d6a392c3ffe120e44f1d2e8109f45cf38d) test(api-keys): expect request rate in key summaries
  * [aff0ce9](https://github.com/yhagus/routerlm-oss/commit/aff0ce9a7438173fcfb5f9ca2e06101c10dd7185) test(api-keys): expect spend limit and spent in key summaries
* `docs`
  * [73392d7](https://github.com/yhagus/routerlm-oss/commit/73392d78ebe5771e99f28e5a570dd6de71c7fad2) test(docs): run the control plane examples against a real Integration
* `general`
  * [e4e5535](https://github.com/yhagus/routerlm-oss/commit/e4e5535e43ae073db7a6bdc22968ed7144fe1c2d) test: keep redis key names out of feature tests
* `quota-meters`
  * [2ed2e8b](https://github.com/yhagus/routerlm-oss/commit/2ed2e8b92c226a27712148b78c11b3f6a628a01b) test(quota-meters): turn on private upstreams in the schedule test

#### Build and CI
* `web`
  * [3851d9b](https://github.com/yhagus/routerlm-oss/commit/3851d9b1a6a44e3d8dc177e754252e7be610d1a8) build(web): run the mirror check in the web check

#### Chores
* `web`
  * [37647f9](https://github.com/yhagus/routerlm-oss/commit/37647f9d977b47624bfb32956ca15cb35f36468c) style(web): trim the integration detail header and panels

**Full Changelog**: https://github.com/yhagus/routerlm-oss/compare/v5.1.0...v6.0.0

# v5.1.0 (2026-11-20)

#### Notable changes

**Upgrade**
* Nothing to do: no migration. Two optional env variables bound a Probe's wait, `PROBE_TIMEOUT_MS` (default 30000) and `PROBE_IMAGE_TIMEOUT_MS` (default 90000) – [005b555](https://github.com/yhagus/routerlm-oss/commit/005b555b01bcdfd966904ad4267beef5e6400f03)

**Error Captures**
* The Error Captures page has a time range and filters for where it failed (Client → gateway or Gateway → Provider), Provider Account, failure reason, what the client got (Recovered or Failed), Model, API Key and Error Origin, all kept in the URL (`GET /api/error-captures` takes the same filters) – [bf28653](https://github.com/yhagus/routerlm-oss/commit/bf28653acd6cbb0f448edde2036e1ca50ea72fa6), [800f308](https://github.com/yhagus/routerlm-oss/commit/800f308bd91153672ff95695331791f1d227564a)
* The Error Captures search also matches the User-Agent, client IP and the request id the Provider returned – [bf28653](https://github.com/yhagus/routerlm-oss/commit/bf28653acd6cbb0f448edde2036e1ca50ea72fa6)

**Playground**
* Probe an Upstream Model from its table row with each Provider Account, as a single Attempt without routing side effects; a refused OAuth sign-in stays enabled – [005b555](https://github.com/yhagus/routerlm-oss/commit/005b555b01bcdfd966904ad4267beef5e6400f03), [2846715](https://github.com/yhagus/routerlm-oss/commit/2846715fae105966c680b7b19e8fff54d6c29eb8), [0ca4835](https://github.com/yhagus/routerlm-oss/commit/0ca483571b314a83da6bd1e6e2c81578c8d33e71), [a9d2fb4](https://github.com/yhagus/routerlm-oss/commit/a9d2fb4437649fa59fd09168fe0d2a1bfdab6a3b)
* Several Upstream Models can be probed at once, and a reasoning model is probed at low effort – [3c66872](https://github.com/yhagus/routerlm-oss/commit/3c6687210ab1e1ef7e819b3eab7a8e4b8ce71f85), [fb389f4](https://github.com/yhagus/routerlm-oss/commit/fb389f45c8a50664d44b23f20e6812e73a5257c8)

#### Features
* `error-captures`
  * [bf28653](https://github.com/yhagus/routerlm-oss/commit/bf28653acd6cbb0f448edde2036e1ca50ea72fa6) feat(error-captures): filter captures by range, hop, account, reason and outcome
* `inference`
  * [005b555](https://github.com/yhagus/routerlm-oss/commit/005b555b01bcdfd966904ad4267beef5e6400f03) feat(inference): add a single-attempt probe path without routing side effects
* `playground`
  * [2846715](https://github.com/yhagus/routerlm-oss/commit/2846715fae105966c680b7b19e8fff54d6c29eb8) feat(playground): probe an upstream model with each provider account
* `web`
  * [800f308](https://github.com/yhagus/routerlm-oss/commit/800f308bd91153672ff95695331791f1d227564a) feat(web): add time range and filters to the error captures page
  * [0ca4835](https://github.com/yhagus/routerlm-oss/commit/0ca483571b314a83da6bd1e6e2c81578c8d33e71) feat(web): probe an upstream model from its table row

#### Bug fixes
* `inference`
  * [a9d2fb4](https://github.com/yhagus/routerlm-oss/commit/a9d2fb4437649fa59fd09168fe0d2a1bfdab6a3b) fix(inference): keep a probe from disabling a refused oauth login
* `playground`
  * [fb389f4](https://github.com/yhagus/routerlm-oss/commit/fb389f45c8a50664d44b23f20e6812e73a5257c8) fix(playground): ask a reasoning model for low effort in a chat probe
* `web`
  * [3c66872](https://github.com/yhagus/routerlm-oss/commit/3c6687210ab1e1ef7e819b3eab7a8e4b8ce71f85) fix(web): let several upstream models probe at once and type failure reasons

#### Refactors
* `inference`
  * [cbfa600](https://github.com/yhagus/routerlm-oss/commit/cbfa600ee9a6821d45b77181f48af9de0a89b6a6) refactor(inference): make a probe destination its own union member

#### Docs
* `agents`
  * [5f9e5e7](https://github.com/yhagus/routerlm-oss/commit/5f9e5e740d547a32571bf7f19407f87faf2ab879) docs(agents): document the release steps and changelog format
* `changelog`
  * [7f7c82e](https://github.com/yhagus/routerlm-oss/commit/7f7c82e8901a1787f661e4ababf189b8a3bffa53) docs(changelog): rewrite v5.0.0 in the module-grouped format
* `glossary`
  * [0d24002](https://github.com/yhagus/routerlm-oss/commit/0d24002f600fe1af7bb60bac8d7f860fb65fe54a) docs(glossary): add probe
* `inference`
  * [107709a](https://github.com/yhagus/routerlm-oss/commit/107709aa09a2f1e6ddb1a3a8b93d2f1ab198325c) docs(inference): list every routing side effect of an attempt

#### Chores
* `agents`
  * [6a5773b](https://github.com/yhagus/routerlm-oss/commit/6a5773bafc48fd08a9de30adb521ece3d888fbaa) chore(agents): let every implementer edit the web mirror check
* `format`
  * [9c2993d](https://github.com/yhagus/routerlm-oss/commit/9c2993d8f377b811179bb5e03e7613dab190b65b) chore(format): add oxfmt config for backend and web
* `git`
  * [28891a4](https://github.com/yhagus/routerlm-oss/commit/28891a41ae1f5dded3cce887b10596dd6a9ede38) chore(git): ignore the codegraph index
* `scripts`
  * [8f47a23](https://github.com/yhagus/routerlm-oss/commit/8f47a2335493b279aa94badfa44ca2d3decbf05d) chore(scripts): keep the test summary last in test:docker output
  * [92b3a14](https://github.com/yhagus/routerlm-oss/commit/92b3a141e1e903b253583bf7b40de4ee585bc528) chore(scripts): generate release notes grouped by type and module

**Full Changelog**: https://github.com/yhagus/routerlm-oss/compare/v5.0.0...v5.1.0

# v5.0.0 (2026-11-19)

#### Notable changes

**Upgrade**
* Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies one new migration: Error Origin, User-Agent and client IP on Usage Logs, User-Agent and client IP on Error Captures, and the Provider request id on Attempts. Existing failed Usage Logs get their Error Origin filled in – [30613c8](https://github.com/yhagus/routerlm-oss/commit/30613c80690903253be67fae215369cea449b1c6)
* **Breaking:** the `ALLOW_PRIVATE_UPSTREAMS` env variable is removed. An instance that set it refuses its LAN upstreams after the upgrade until a User turns on "Allow private upstreams" in Settings (ADR 0030). Remove the variable from your `.env` – [d36cd80](https://github.com/yhagus/routerlm-oss/commit/d36cd805aecce33a4aa3781a0a4c72a59d575442)
* **Personal data:** every Usage Log and Error Capture records the client's User-Agent and IP address (resolved through `TRUST_PROXY`), kept as long as the Usage Logs are (ADR 0032). Existing rows get neither – [6218868](https://github.com/yhagus/routerlm-oss/commit/62188684eaba1259d32891b46920391bc3ec7fd2)

**Error Origin**
* Every failed request records its Error Origin: Client, Upstream or Gateway. Successful, cancelled and Fallback-recovered requests have none (ADR 0031). Client error codes and messages are unchanged – [6218868](https://github.com/yhagus/routerlm-oss/commit/62188684eaba1259d32891b46920391bc3ec7fd2), [9ad63e5](https://github.com/yhagus/routerlm-oss/commit/9ad63e5712280074d43d0bbd6026e9d681301757)
* The Overview shows Client, Upstream and Gateway tiles beside the total error rate, each linking to the Usage page filtered to that origin, and stacks the error-rate chart by origin – [c212953](https://github.com/yhagus/routerlm-oss/commit/c2129532b74299709fc1e7b86dbe26a4fb8f1dac), [514f210](https://github.com/yhagus/routerlm-oss/commit/514f21033b1ffc873de9e0283e9152d0181f64a6), [95948ff](https://github.com/yhagus/routerlm-oss/commit/95948ffe3e6ac130f3ef97a00e10ab7777f73bb2)
* The Usage page filters by Error Origin, shows it next to the error code and splits its failed count by origin – [ab62f08](https://github.com/yhagus/routerlm-oss/commit/ab62f08ee62117ed9cb3d1dc1de5720bcee27d2d), [cf92b04](https://github.com/yhagus/routerlm-oss/commit/cf92b04d6ae4e004c8de07fb252cd24ebdbe8155), [f41b6f7](https://github.com/yhagus/routerlm-oss/commit/f41b6f7b171a9bce2d194146aa3fde3a6c140c73)

**Usage Logs**
* A Usage Log has a detail page with its User-Agent, IP and Attempts, each with the request id its Provider returned (`GET /api/usage/:id`) – [1fd6b2a](https://github.com/yhagus/routerlm-oss/commit/1fd6b2ac381b288df5ad94552124df671e9436b1), [51315a1](https://github.com/yhagus/routerlm-oss/commit/51315a1ffde88e73a9a6ca5451d76925829bef17)
* The Usage search also matches User-Agents and IP addresses – [ab62f08](https://github.com/yhagus/routerlm-oss/commit/ab62f08ee62117ed9cb3d1dc1de5720bcee27d2d)
* The Error Capture view shows the User-Agent, IP and Provider request id – [fdad791](https://github.com/yhagus/routerlm-oss/commit/fdad7912e5fc173789ca805818967d29b8f6c496)

**Settings**
* "Allow private upstreams" lets Provider URLs point at private hosts over plain http, changed from the dashboard while the gateway runs – [d36cd80](https://github.com/yhagus/routerlm-oss/commit/d36cd805aecce33a4aa3781a0a4c72a59d575442)

#### Features
* `demo`
  * [d1c78eb](https://github.com/yhagus/routerlm-oss/commit/d1c78eb2868f1bdb6d366e639648e7a4be609a15) feat(demo): record error origin, user-agent and client ip on demo traffic
* `overview`
  * [514f210](https://github.com/yhagus/routerlm-oss/commit/514f21033b1ffc873de9e0283e9152d0181f64a6) feat(overview): count failed requests and share the per-origin predicate
  * [c212953](https://github.com/yhagus/routerlm-oss/commit/c2129532b74299709fc1e7b86dbe26a4fb8f1dac) feat(overview): split failed requests by error origin
* `settings`
  * [d36cd80](https://github.com/yhagus/routerlm-oss/commit/d36cd805aecce33a4aa3781a0a4c72a59d575442) feat(settings): allow private upstreams from a runtime setting (**breaking**)
* `usage`
  * [6218868](https://github.com/yhagus/routerlm-oss/commit/62188684eaba1259d32891b46920391bc3ec7fd2) feat(usage): record error origin, client user-agent, ip and provider request id
  * [1fd6b2a](https://github.com/yhagus/routerlm-oss/commit/1fd6b2ac381b288df5ad94552124df671e9436b1) feat(usage): add usage log detail route with its attempts
  * [cf92b04](https://github.com/yhagus/routerlm-oss/commit/cf92b04d6ae4e004c8de07fb252cd24ebdbe8155) feat(usage): split the summary's failed count by error origin
  * [ab62f08](https://github.com/yhagus/routerlm-oss/commit/ab62f08ee62117ed9cb3d1dc1de5720bcee27d2d) feat(usage): filter usage logs by error origin and search user-agent and ip
  * [30613c8](https://github.com/yhagus/routerlm-oss/commit/30613c80690903253be67fae215369cea449b1c6) feat(usage): add error origin, client user-agent and ip columns
* `web`
  * [f41b6f7](https://github.com/yhagus/routerlm-oss/commit/f41b6f7b171a9bce2d194146aa3fde3a6c140c73) feat(web): filter and badge usage logs by error origin
  * [fdad791](https://github.com/yhagus/routerlm-oss/commit/fdad7912e5fc173789ca805818967d29b8f6c496) feat(web): show user-agent, ip and provider request id on error captures
  * [51315a1](https://github.com/yhagus/routerlm-oss/commit/51315a1ffde88e73a9a6ca5451d76925829bef17) feat(web): add the usage log detail view with its attempts
  * [780cc70](https://github.com/yhagus/routerlm-oss/commit/780cc705a0e300778fe1652d7e4c874adb477c71) feat(web): mirror error origin, user-agent and ip in usage and capture types
  * [95948ff](https://github.com/yhagus/routerlm-oss/commit/95948ffe3e6ac130f3ef97a00e10ab7777f73bb2) feat(web): show overview error rates by origin

#### Bug fixes
* `inference`
  * [9ad63e5](https://github.com/yhagus/routerlm-oss/commit/9ad63e5712280074d43d0bbd6026e9d681301757) fix(inference): close the attempt of a refused stream as interrupted

#### Refactors
* `inference`
  * [c979b90](https://github.com/yhagus/routerlm-oss/commit/c979b90ea471ca2a2933ca7b5562fc45c37ead33) refactor(inference): read upstream response headers once and name the media request
* `usage`
  * [0d9a59c](https://github.com/yhagus/routerlm-oss/commit/0d9a59c0cb594a546939ac11612687c21c899eb7) refactor(usage): build per-origin breakdowns from one helper and predicate
* `web`
  * [fca03ba](https://github.com/yhagus/routerlm-oss/commit/fca03bafa28a4202fd7f7a3d15b9b35f69acf690) refactor(web): share overview tooltip rows and read failedCount
  * [20465d3](https://github.com/yhagus/routerlm-oss/commit/20465d3d0caa2da249184f9b8d5e7bb48a82a3f4) refactor(web): share one attempt outcome label helper

#### Docs
* `adr`
  * [e729279](https://github.com/yhagus/routerlm-oss/commit/e729279a2774e8520d6a1a4592963a4aa290e6a2) docs(adr): define error origin and record client user-agent and ip
* `readme`
  * [dae8801](https://github.com/yhagus/routerlm-oss/commit/dae88012ed2713a9685d6b5b5060faa9e0c81bc3) docs(readme): drop emoji from headings, nav and bullets
  * [8ed6d75](https://github.com/yhagus/routerlm-oss/commit/8ed6d75bf7a320d6ad198cf066056cce0f0b3295) docs(readme): restyle with a centered header, sections and endpoints table
  * [3750dd9](https://github.com/yhagus/routerlm-oss/commit/3750dd9c235c3a1f11a4809ff97bb356f057c023) docs(readme): cover media models, api key management and encryption

#### Tests
* `usage`
  * [53813f6](https://github.com/yhagus/routerlm-oss/commit/53813f6f2151cd8915b004321fe6327c7ace6fcf) test(usage): read attempt request ids from the usage detail API

#### Chores
* `claude`
  * [a41f56b](https://github.com/yhagus/routerlm-oss/commit/a41f56bf5097b7afbec0eb0a8946cb7cab4940ea) chore(claude): add a skill to run the dashboard on demo data
* `license`
  * [eafd431](https://github.com/yhagus/routerlm-oss/commit/eafd4318418c90ecc179b7d83ca2b5c7539af4a8) chore(license): drop 9router attribution from notice
* `scripts`
  * [6fb9e50](https://github.com/yhagus/routerlm-oss/commit/6fb9e5041d799b6f2fd9515faa834200db85bee7) chore(scripts): fail on web copies of backend constants missing a mirror
  * [3dfd792](https://github.com/yhagus/routerlm-oss/commit/3dfd79280eda4443e2f1db424d70fd2afc75e2cd) chore(scripts): check the web copy of error origins

**Full Changelog**: https://github.com/yhagus/routerlm-oss/compare/v4.0.0...v5.0.0

# v4.0.0 (2026-11-19)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies six new migrations. They turn each Provider's Protocol and base URL into its chat endpoint, give Models and Upstream Models a Kind, add Alibaba Model Studio's image, speech, transcription and video endpoints, and add API Key encryption and rotation history.
- **Breaking:** the dashboard API describes a Provider by `endpoints`, a list with at most one `{ kind, protocol, baseUrl }` per Model Kind, instead of one `protocol` and `baseUrl`. Scripts that create or edit Providers through `/api/providers` must send `endpoints`. Catalog files use the same shape.
- **Behaviour change:** new API Keys are stored encrypted with `ENCRYPTION_KEY`, as well as hashed, so the dashboard can copy them again (ADR 0029). Keys created before this release can't be copied until they are rotated. Revoking a key drops its encrypted copy.

## Image, speech, transcription and video models

- A Model and an Upstream Model have a Kind: chat, image, speech, transcription or video. Media Kinds are priced per unit (per image, per 1M characters, per audio second, per second of video) instead of per token.
- New endpoints, served through Alibaba Model Studio's DashScope Protocols: `/v1/images/generations` and `/v1/images/edits`, `/v1/audio/speech`, `/v1/audio/transcriptions`, and `/v1/videos` to submit a job, poll it and download the result. A video id is an encrypted handle to the upstream task, so any instance can answer a poll (ADR 0027), and media bytes are relayed rather than handing out upstream URLs (ADR 0028).
- A Parameter Policy can force the watermark on media requests.
- The Playground generates and edits images, synthesizes speech, transcribes audio and runs video jobs.
- Error Captures replace media bytes with placeholders.

## API Keys

- Each key's "…" menu copies the full key, edits its name, expiry and allowed Models, rotates it and revokes it. Rotating keeps the key's settings and usage history and refuses the old key at once.
- A Last rotated column opens each key's rotation history: when, by whom, and which key replaced which.
- Allowed Models is picked from a menu, and the form says plainly when a key allows every Model, including ones added later.

## Providers

- A Provider has one endpoint per Model Kind, each with its own Protocol and base URL, all served by the same Provider Account (ADR 0026).
- New Upstream Models: Gemini 4 Neon; GPT-6.2 Sol and Astra on OpenAI Codex; Qwen Image and Wan 2.7 image models, Wan 3.0 Video and HappyHorse 1.1 (text, image and reference to video), Qwen Audio 3.0 TTS Plus and Qwen Audio 3.0 ASR Flash on Alibaba Model Studio.

## Dashboard

- The Providers list and a Provider's page show its endpoints on one line, as an icon per Model Kind with the Protocol in a tooltip.
- Upstream Models show one Price column for every Kind: the amount over its unit, with every price line, such as cache or per-resolution prices, on hover.
- The endpoint fields in the Provider form no longer overlap, and stack on narrow screens.

## Other

- An Upstream Model's Kind can't change while Routes use it.
- A video download that fails to start answers 502.
- Images up to 1536×1536 are priced at the 1K tier.

# v3.3.0 (2026-11-18)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies three new migrations. One merges duplicate Provider Accounts that a single OAuth sign-in created, moving their usage history onto the account it keeps.
- **Behaviour change:** Provider URLs (`baseUrl`, `quotaBaseUrl` and the OAuth login hosts and issuer) must now be https and must not point at localhost, loopback, private or link-local addresses, in Catalog files and in the dashboard. Self-hosters with a LAN upstream, such as Ollama or vLLM, must set `ALLOW_PRIVATE_UPSTREAMS=true` in `.env`. A stored URL that no longer passes is not rewritten, and the gateway refuses to connect to it.
- **Behaviour change:** an upstream 403 now starts a Cooldown instead of disabling the Provider Account. The third 403 in a row, with no successful request between, disables it. A 401 still disables it at once.
- Behind a reverse proxy, set `TRUST_PROXY` (to `true`, or to the proxy's address or subnet). It is off by default, so a forged `X-Forwarded-For` is ignored. Without it, every client appears as the proxy's IP.
- To use more than one CPU, set `BACKEND_PROCESSES` in `.env` to the VM's CPU count. It defaults to 1, as before. It works on Linux hosts only; elsewhere the backend logs a warning and runs one process.

## Performance

- The backend can run several gateway processes on one port (`BACKEND_PROCESSES`). Before, it used one CPU however large the VM was.
- Streams pass through one relay loop instead of eight stages per token, and common stream chunks skip full schema validation.
- Each request waits on Redis less: Cooldown state comes from a per-process copy at most one second old.
- On the k6 benchmark (2 CPUs for the gateway, 1,800 virtual users, a 2.2 s upstream answer), throughput rose from 444 to 644 requests per second and the median latency fell from 3.31 s to 2.37 s. The gateway alone handled 4,825 requests per second, up from 2,081.

## Security

- Every backend instance reloads its snapshot from the database every 30 seconds (`SNAPSHOT_RELOAD_INTERVAL_MS`), and retries a failed reload after a change. A revoked API Key or a disabled Provider now stops working on every instance within that interval, even when the change notice was lost or Redis was down.
- `POST /api/auth/login` allows 10 attempts a minute per client IP and answers 429 beyond that. The count is shared across instances through Redis, and login stays open if Redis is down.
- The gateway does not rate limit `/v1`. Do that in your reverse proxy.
- Login caps the length of the email and password it accepts.
- A failing database health check answers 503 without the database's error text.
- Requests to models.dev no longer follow redirects.

## Providers

- New Providers: Xiaomi MiMo Token Plan (MiMo-V2.6-Pro, MiMo-V2.6-Flash) and Meta AI (Muse Ember 1.0, Muse Wonder 1.0, Muse Spark 1.3, 1.2 and 1.1). Both carry a Terms Risk flag, so they serve requests only while the "Allow terms-risk providers" Setting is on.

## Dashboard

- The Parameter Policy has a thinking budget Cap, which bounds Anthropic `thinking.budget_tokens`. A Cap never fills in a value the client omitted, and the dashboard points out a Cap that has no default.
- Usage Logs keep the names they showed when the request was made. Renaming or deleting a Model, Provider, Provider Account or API Key no longer changes or blanks old rows. A Playground row shows "deleted user" once its User is gone.

## Other

- One OAuth sign-in creates exactly one Provider Account, even when its result is polled twice.
- On SIGTERM the backend now shuts down cleanly instead of stopping at once.
- A stream the gateway cannot translate for the client, such as tool call arguments that arrive interleaved, ends with the client Protocol's error event.
- A usage job that fails for good is removed from Redis.

# v3.2.0 (2026-11-18)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies two new migrations.
- **Behaviour change:** Kimi Code, MiniMax M Plan and OpenAI Codex now carry a Terms Risk flag, because their plans may not allow the gateway's use. While the new "Allow terms-risk providers" Setting is off, which is the default, these Providers serve no inference and are not listed to clients. An instance that uses one of them must turn the Setting on in the dashboard Settings page. Each Provider's own enabled flag is untouched.

## Providers

- New Provider: Google Gemini, through its OpenAI-compatible endpoint, with Gemini 4 Hydrogen, Carbon and Argon, Gemini 3.8 Flash, 3.7 Flash and 3.5 Flash Lite.
- New Providers: Command Code and OpenCode Go. OpenCode Go forwards the client's user agent and session to its upstream.
- OpenAI gains GPT-6.2 Astra and GPT-6.2 Sol, with the Fast service tier.

## Dashboard

- A Provider that speaks the OpenAI chat Protocol has a "Forwarded client headers" field, for request headers passed on to the Provider, such as `user-agent`.
- The first page you open in a browser session shows a notice when models.dev lists one of the 5 newest models of your Providers that your Catalog does not hold yet. It only reports; it adds nothing. If models.dev cannot be reached, nothing is shown.

## Other

- The license is now Apache-2.0, up from MIT.

# v3.1.0 (2026-11-17)

## Upgrade

- Run `docker compose pull`, then `docker compose up -d`. The `migrate` service applies one new migration.
- Nothing is breaking. The migration raises an Upstream Model's context size or max output only where it still holds the old Catalog value, so a value you edited is kept.

## Providers

- The Catalog now gives each Upstream Model the most context and output its Provider accepts, not a default. Where a Provider's docs are silent, the figures are models.dev's.
- Kimi K3, K3.1 Pro and K3.1 Pro Highspeed (Moonshot and Kimi Code) can output up to 1,048,576 tokens, up from 131,072, which is only Moonshot's default. On Kimi Code, K3 and K3.1 Pro have a 1,048,576 context, which Pro plans and higher get; on a lower plan, lower the context size of those two models. K3 256K can output up to 262,144.
- OpenAI Codex models take the `max_context_window` of the Codex CLI's model list, 872,000 for eight of them, up from the CLI's default 272,000. GPT-5.5 stays at 272,000.
- DeepSeek models have a 1,048,576 context and a 393,216 max output.
- MiniMax M3 and M3.1 Flash on the M Plan have a 1,000,000 context, up from 524,288. GLM-5.2 on Alibaba has 1,048,576.

# v3.0.0-rc.1 (2026-11-17)

## Upgrade

- **Install from published images.** RouterLM now ships as the images `ghcr.io/yhagus/routerlm-backend` and `ghcr.io/yhagus/routerlm-web` (amd64 and arm64), with a `compose.yaml` attached to each GitHub Release. Installing no longer needs a clone. See ADR 0018 and the README's Quick start.
- **Moving an install made from a clone** keeps its data: `compose.yaml` uses the same project name (`routerlm-oss`) and volume names. In the clone's folder, run `docker compose down`, download the release's `compose.yaml`, add `POSTGRES_PASSWORD` to `.env` (`routerlm` unless you set another one when the database was created), then `docker compose -f compose.yaml up -d`. Keep the same `ENCRYPTION_KEY`. If the folder is not named `routerlm-oss`, also set `COMPOSE_PROJECT_NAME` to its name.
- **Breaking:** `POSTGRES_PASSWORD` has no default in `compose.yaml`; the stack does not start without it.
- **Breaking:** the `ERROR_CAPTURE_RETENTION_DAYS` environment variable is removed. An instance that set it falls back to 7 days until a User changes the Retention Period in the dashboard.

## Dashboard

- The Retention Period of Error Captures is now a Setting you change from the dashboard, from 1 to 365 days. It is 7 days until you change it, and a change applies at the next hourly run without a restart. See ADR 0017.

# v2.1.0 (2026-11-17)

RouterLM 2.1 adds OpenAI Codex as a Provider, Service Tiers, and Indonesian client docs.

## Upgrade

- Run `git pull`, then `docker compose up -d`. The `migrate` service applies seven new migrations and adds the new Catalog rows on start.
- Nothing is breaking. Existing Providers, Models and API Keys keep working.

## Gateway

- A Route can now send to an upstream that uses the OpenAI Responses protocol.
- Service Tiers: a client or a Parameter Policy can ask for the `fast` or `flex` tier. Only OpenAI and OpenAI Codex have Service Tiers, and each maps the tier to its own value. Other Providers ignore the tier. A Parameter Policy can force a tier or forbid one. If the Route's upstream model does not accept the tier, the gateway drops the tier for that Attempt and sends the request anyway. See ADR 0014.
- The Usage Log records the tier that served each request. Cost uses that tier's price when the upstream model has one.

## Providers

- The Catalog adds OpenAI Codex. It accepts only an OAuth login: the operator signs in with a ChatGPT plan through the Codex CLI's device-code flow. See ADR 0013 for the risks.
- OpenAI Codex accounts show a quota meter, with the account's email and plan. A used-up plan is marked exhausted and skipped until its quota resets.
- A Provider states which credential kinds it accepts. You cannot add an API key to OpenAI Codex.
- The OpenAI Provider now has the `fast` and `flex` Service Tiers.
- Every upstream model has a display name.

## Dashboard

- The provider form has a logo picker and the advanced fields.
- The OAuth login settings can be edited for each flow, and the dashboard can sign in to OpenAI Codex.
- Parameter Policies and upstream models can set Service Tiers. Usage shows the served tier and can filter by it.
- The upstream models list groups models that share an id across Providers. It shows the name above the id. Click the name to copy the id.
- Recovered Error Captures show as a success, not as an error.
- The last x-axis label on charts no longer overlaps the tick before it.

## Client docs

- `/docs` is now available in English and Indonesian (`/id/docs`). `/doc` redirects to `/docs`.
- The Errors page calls the JSON error shape an "error body" and explains each field. The Indonesian pages use plain wording and shorter titles.

## Repository

- The README has features, a quick start, and light and dark screenshots.
- The repository has an MIT license.
- `bun run db:seed:demo` seeds demo data for taking the screenshots again.

**Full changelog:** https://github.com/yhagus/routerlm-oss/compare/v2.0.0...v2.1.0

# v2.0.0 (2026-11-16)

RouterLM 2 is a rewrite. The backend is NestJS on Bun with PostgreSQL and Redis. The dashboard is a Nuxt app. The v1 app lives in `legacy/` and its history is in `legacy/CHANGELOG.md`.

## Breaking changes

- v2 needs PostgreSQL and Redis. `docker compose up -d` starts both, with the backend, the worker and the dashboard.
- v2 does not import v1 data. Add Providers, Provider Accounts, Models and API Keys again.
- Set `ENCRYPTION_KEY` before the first start (`openssl rand -base64 32`). Provider Account keys are encrypted with it. Losing it makes them unreadable.
- This release has no npm package and no container image. `@ciwergrp/routerlm` and `ghcr.io/yhagus/routerlm-oss` stay at 1.6.5.

## Gateway

- Clients can call `/v1/chat/completions`, `/v1/messages` and `/v1/responses`. Every request is converted to one internal format and sent to an OpenAI Chat or Anthropic Messages upstream.
- A Model has ordered Routes. If a Route fails, Fallback tries the next one. A failing Provider Account goes into Cooldown. When every account is in Cooldown or exhausted, the gateway answers 429.
- Each Route can override the timeout and the parameter policy of its Model.
- Automatic cache breakpoints and a prompt cache key can be switched on per Model.
- The gateway never stores prompt or response content.

## Providers

- The Catalog ships Alibaba Model Studio Intl, Anthropic, DeepSeek, Kimi Code, MiniMax API, MiniMax M Plan, Moonshot, OpenAI and Xiaomi MiMo. Upstream models show their release date from models.dev.
- Kimi Code works with an API key or with "Sign in with Kimi". The OAuth login stays valid on its own.
- MiniMax M Plan and Kimi Code accounts show quota meters. An exhausted account is skipped until its quota resets.
- The provider detail page has an Accounts tab and a Models tab.

## Dashboard

- First-run setup creates the first user. Users sign in with a session.
- Overview shows usage charts, with an empty state that walks through setup.
- Usage lists every request with its Attempts, totals, multi-value filters and text search.
- Error Captures keep failed requests and recovered Attempts for 30 days (`ERROR_CAPTURE_RETENTION_DAYS`).
- The Playground sends to a Model or straight to an upstream model.
- API Keys, Users, Models, Usage, Error Captures and upstream models use one data table with search, filters, column picker and paging. Filters, range and page are kept in the URL.
- `/docs` has client documentation with tested examples.

## Run

```bash
git clone https://github.com/yhagus/routerlm-oss.git
cd routerlm-oss
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" > .env
docker compose up -d
```

The dashboard is at http://localhost:3001 and the API at http://localhost:3000.

**Full changelog:** https://github.com/yhagus/routerlm-oss/compare/v1.6.5...v2.0.0
