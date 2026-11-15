-- The MiniMax Provider becomes MiniMax API (pay-as-you-go), next to the new
-- MiniMax M Plan. Renaming in place keeps the Provider's UUID, so its Provider
-- Accounts, Upstream Models and Routes stay attached. A name the operator
-- changed is kept.
UPDATE "providers" SET "name" = 'MiniMax API' WHERE "slug" = 'minimax' AND "name" = 'MiniMax';
--> statement-breakpoint
UPDATE "providers" SET "slug" = 'minimax-api' WHERE "slug" = 'minimax';
