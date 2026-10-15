-- Verde Marea — правила, которые Prisma не выражает (spec.md, разделы 3–6).
-- CHECK, EXCLUDE, уникальность закрытий, триггеры вместимости, переходов и защиты ролей,
-- функции vm_* для операций и расчёта окон. AuditLog и Notification пишут триггеры
-- в той же транзакции, что и изменение; без объявленного автора изменение отклоняется.
--
-- Коды ошибок: сообщение исключения = код `VM_*` (lib/booking/errors.ts переводит их в текст).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Константы и вспомогательные функции (зеркало lib/booking/rules.ts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vm_tz() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'Europe/Moscow'::text $$;

CREATE OR REPLACE FUNCTION vm_slot_times() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['12:00','13:30','15:00','16:30','18:00','19:30']::text[] $$;

CREATE OR REPLACE FUNCTION vm_slot_duration() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '90 minutes' $$;

CREATE OR REPLACE FUNCTION vm_horizon_days() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 14 $$;

CREATE OR REPLACE FUNCTION vm_cancel_deadline() RETURNS interval
LANGUAGE sql IMMUTABLE AS $$ SELECT interval '3 hours' $$;

CREATE OR REPLACE FUNCTION vm_max_guests() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 8 $$;

-- «Сейчас» для правил. Приложение никогда не задаёт vm.now; его выставляет только
-- scripts/check-rules.ts и prisma/seed.ts внутри своей транзакции (SET LOCAL),
-- чтобы проверить дедлайны и переходы во времени детерминированно.
-- По умолчанию clock_timestamp(): записи истории внутри одной транзакции сохраняют порядок.
CREATE OR REPLACE FUNCTION vm_now() RETURNS timestamptz
LANGUAGE sql VOLATILE AS $$
  SELECT COALESCE(NULLIF(current_setting('vm.now', true), '')::timestamptz, clock_timestamp())
$$;

CREATE OR REPLACE FUNCTION vm_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (vm_now() AT TIME ZONE vm_tz())::date $$;

CREATE OR REPLACE FUNCTION vm_slot_starts_at(p_date date, p_time text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT (p_date + p_time::time) AT TIME ZONE vm_tz() $$;

CREATE OR REPLACE FUNCTION vm_local_date(p_ts timestamptz) RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (p_ts AT TIME ZONE vm_tz())::date $$;

CREATE OR REPLACE FUNCTION vm_local_time(p_ts timestamptz) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT to_char(p_ts AT TIME ZONE vm_tz(), 'HH24:MI') $$;

CREATE OR REPLACE FUNCTION vm_format_local(p_ts timestamptz) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT to_char(p_ts AT TIME ZONE vm_tz(), 'DD.MM.YYYY HH24:MI') $$;

-- Начало совпадает с одним из окон и не приходится на понедельник.
CREATE OR REPLACE FUNCTION vm_is_valid_start(p_ts timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('minute', p_ts) = p_ts
     AND vm_local_time(p_ts) = ANY (vm_slot_times())
     AND extract(isodow FROM vm_local_date(p_ts)) <> 1
$$;

CREATE OR REPLACE FUNCTION vm_in_horizon(p_date date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_date >= vm_today() AND p_date < vm_today() + vm_horizon_days()
$$;

CREATE OR REPLACE FUNCTION vm_is_closed(p_date date, p_time text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "SlotClosure" c
    WHERE c."date" = p_date AND (c."startTime" IS NULL OR c."startTime" = p_time)
  )
$$;

CREATE OR REPLACE FUNCTION vm_is_staff(p_role "Role") RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p_role IN ('admin', 'super_admin') $$;

CREATE OR REPLACE FUNCTION vm_new_id() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24)
$$;

CREATE OR REPLACE FUNCTION vm_fail(p_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = p_code, ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION vm_actor_role(p_actor_id text) RETURNS "Role"
LANGUAGE plpgsql STABLE AS $$
DECLARE v_role "Role";
BEGIN
  SELECT u."role" INTO v_role FROM "User" u WHERE u."id" = p_actor_id;
  IF v_role IS NULL THEN
    PERFORM vm_fail('VM_ACTOR_NOT_FOUND');
  END IF;
  RETURN v_role;
END $$;

-- Автор изменения для триггеров истории (действует до конца транзакции).
CREATE OR REPLACE FUNCTION vm_set_actor(p_actor_id text) RETURNS void
LANGUAGE sql AS $$ SELECT set_config('vm.actor_id', p_actor_id, true); $$;

CREATE OR REPLACE FUNCTION vm_current_actor() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v_actor text := NULLIF(current_setting('vm.actor_id', true), '');
BEGIN
  IF v_actor IS NULL THEN
    PERFORM vm_fail('VM_ACTOR_REQUIRED');
  END IF;
  RETURN v_actor;
END $$;

-- ---------------------------------------------------------------------------
-- 2. CHECK, уникальность, EXCLUDE
-- ---------------------------------------------------------------------------

ALTER TABLE "User"
  ADD CONSTRAINT "User_name_length" CHECK (char_length(btrim("name")) BETWEEN 2 AND 60),
  ADD CONSTRAINT "User_email_lowercase" CHECK ("email" = lower("email") AND "email" LIKE '%_@_%');

ALTER TABLE "Table"
  ADD CONSTRAINT "Table_capacity_range" CHECK ("capacity" BETWEEN 1 AND 12),
  ADD CONSTRAINT "Table_zone_valid" CHECK ("zone" IN ('Зал', 'Веранда'));

ALTER TABLE "SlotClosure"
  ADD CONSTRAINT "SlotClosure_start_time_valid"
    CHECK ("startTime" IS NULL OR "startTime" IN ('12:00','13:30','15:00','16:30','18:00','19:30')),
  ADD CONSTRAINT "SlotClosure_reason_length" CHECK (char_length(btrim("reason")) BETWEEN 1 AND 120);

-- Одно закрытие на (date, startTime) и одно закрытие всего дня (startTime IS NULL).
CREATE UNIQUE INDEX "SlotClosure_date_window_key"
  ON "SlotClosure" ("date", "startTime") WHERE "startTime" IS NOT NULL;
CREATE UNIQUE INDEX "SlotClosure_date_whole_day_key"
  ON "SlotClosure" ("date") WHERE "startTime" IS NULL;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_duration_90" CHECK ("endsAt" = "startsAt" + interval '90 minutes'),
  ADD CONSTRAINT "Booking_guests_range" CHECK ("guests" BETWEEN 1 AND 8),
  ADD CONSTRAINT "Booking_table_no_overlap" EXCLUDE USING gist (
    "tableId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  ) WHERE ("status" IN ('pending', 'confirmed')),
  ADD CONSTRAINT "Booking_user_no_overlap" EXCLUDE USING gist (
    "userId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  ) WHERE ("status" IN ('pending', 'confirmed'));

-- ---------------------------------------------------------------------------
-- 3. Триггеры Booking: вместимость, неизменяемые поля, переходы, история
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vm_booking_before_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_capacity int;
  v_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t."capacity", t."isActive" INTO v_capacity, v_active FROM "Table" t WHERE t."id" = NEW."tableId";
    IF v_capacity IS NULL THEN
      PERFORM vm_fail('VM_TABLE_NOT_FOUND');
    END IF;
    IF NEW."guests" > v_capacity THEN
      PERFORM vm_fail('VM_CAPACITY');
    END IF;
    IF NEW."status" IN ('pending', 'confirmed') AND NOT v_active THEN
      PERFORM vm_fail('VM_TABLE_INACTIVE');
    END IF;
    IF NOT vm_is_valid_start(NEW."startsAt") THEN
      PERFORM vm_fail('VM_INVALID_SLOT');
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: бронирование не редактируется (spec.md, раздел 9), меняется только статус.
  IF NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."tableId" IS DISTINCT FROM OLD."tableId"
     OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
     OR NEW."endsAt" IS DISTINCT FROM OLD."endsAt"
     OR NEW."guests" IS DISTINCT FROM OLD."guests" THEN
    PERFORM vm_fail('VM_BOOKING_IMMUTABLE');
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" IN ('cancelled', 'completed', 'no_show') THEN
      PERFORM vm_fail('VM_TERMINAL_STATUS');
    END IF;
    IF NOT (
      (OLD."status" = 'pending'   AND NEW."status" IN ('confirmed', 'cancelled')) OR
      (OLD."status" = 'confirmed' AND NEW."status" IN ('cancelled', 'completed', 'no_show'))
    ) THEN
      PERFORM vm_fail('VM_INVALID_TRANSITION');
    END IF;
    IF NEW."status" IN ('confirmed', 'cancelled') AND vm_now() >= OLD."startsAt" THEN
      PERFORM vm_fail('VM_WINDOW_STARTED');
    END IF;
    IF NEW."status" IN ('completed', 'no_show') AND vm_now() < OLD."startsAt" THEN
      PERFORM vm_fail('VM_WINDOW_NOT_STARTED');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Booking_before_write"
  BEFORE INSERT OR UPDATE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION vm_booking_before_write();

CREATE OR REPLACE FUNCTION vm_booking_message(p_type "NotificationType", p_starts_at timestamptz, p_table_code text, p_guests int)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE p_type
    WHEN 'booking_created'   THEN 'Бронирование на ' || vm_format_local(p_starts_at) || ' создано: стол ' || p_table_code || ', гостей: ' || p_guests || '. Ожидает подтверждения.'
    WHEN 'booking_confirmed' THEN 'Бронирование на ' || vm_format_local(p_starts_at) || ' подтверждено. Ждём вас за столом ' || p_table_code || '.'
    WHEN 'booking_cancelled' THEN 'Бронирование на ' || vm_format_local(p_starts_at) || ' отменено.'
    WHEN 'booking_completed' THEN 'Спасибо, что были у нас ' || vm_format_local(p_starts_at) || '. Будем рады видеть снова.'
    WHEN 'booking_no_show'   THEN 'Бронирование на ' || vm_format_local(p_starts_at) || ' отмечено как неявка.'
  END
$$;

CREATE OR REPLACE FUNCTION vm_booking_after_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor text := vm_current_actor();
  v_code text;
  v_type text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NULL;
  END IF;

  SELECT t."code" INTO v_code FROM "Table" t WHERE t."id" = NEW."tableId";
  v_type := CASE WHEN TG_OP = 'INSERT' THEN 'booking_created' ELSE 'booking_' || NEW."status"::text END;

  INSERT INTO "AuditLog" ("id", "actorId", "action", "bookingId", "targetUserId", "details", "createdAt")
  VALUES (
    vm_new_id(), v_actor, v_type::"AuditAction", NEW."id", NEW."userId",
    jsonb_build_object(
      'from', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."status"::text END,
      'to', NEW."status"::text,
      'startsAt', NEW."startsAt",
      'tableCode', v_code,
      'guests', NEW."guests"
    ),
    vm_now()
  );

  INSERT INTO "Notification" ("id", "userId", "bookingId", "type", "message", "createdAt")
  VALUES (
    vm_new_id(), NEW."userId", NEW."id", v_type::"NotificationType",
    vm_booking_message(v_type::"NotificationType", NEW."startsAt", v_code, NEW."guests"),
    vm_now()
  );
  RETURN NULL;
END $$;

CREATE TRIGGER "Booking_after_write"
  AFTER INSERT OR UPDATE OF "status" ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION vm_booking_after_write();

-- ---------------------------------------------------------------------------
-- 4. Триггеры User: защита роли super_admin и история смены роли
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vm_user_role_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_bypass boolean := COALESCE(current_setting('vm.allow_super_admin', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."role" = 'super_admin' AND NOT v_bypass THEN
      PERFORM vm_fail('VM_ROLE_PROTECTED');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role"
     AND (OLD."role" = 'super_admin' OR NEW."role" = 'super_admin')
     AND NOT v_bypass THEN
    PERFORM vm_fail('VM_ROLE_PROTECTED');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "User_role_guard"
  BEFORE INSERT OR UPDATE OF "role" ON "User"
  FOR EACH ROW EXECUTE FUNCTION vm_user_role_guard();

CREATE OR REPLACE FUNCTION vm_user_role_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" IS DISTINCT FROM OLD."role" THEN
    INSERT INTO "AuditLog" ("id", "actorId", "action", "bookingId", "targetUserId", "details", "createdAt")
    VALUES (
      vm_new_id(), vm_current_actor(), 'role_changed', NULL, NEW."id",
      jsonb_build_object('from', OLD."role"::text, 'to', NEW."role"::text),
      vm_now()
    );
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "User_role_audit"
  AFTER UPDATE OF "role" ON "User"
  FOR EACH ROW EXECUTE FUNCTION vm_user_role_audit();

-- ---------------------------------------------------------------------------
-- 5. Триггеры SlotClosure: история закрытия и открытия
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vm_slot_closure_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "AuditLog" ("id", "actorId", "action", "details", "createdAt")
    VALUES (
      vm_new_id(), NEW."createdById", 'slot_closed',
      jsonb_build_object('date', to_char(NEW."date", 'YYYY-MM-DD'), 'startTime', NEW."startTime", 'reason', NEW."reason"),
      vm_now()
    );
    RETURN NULL;
  END IF;
  INSERT INTO "AuditLog" ("id", "actorId", "action", "details", "createdAt")
  VALUES (
    vm_new_id(), vm_current_actor(), 'slot_opened',
    jsonb_build_object('date', to_char(OLD."date", 'YYYY-MM-DD'), 'startTime', OLD."startTime", 'reason', OLD."reason"),
    vm_now()
  );
  RETURN NULL;
END $$;

CREATE TRIGGER "SlotClosure_audit"
  AFTER INSERT OR DELETE ON "SlotClosure"
  FOR EACH ROW EXECUTE FUNCTION vm_slot_closure_audit();

-- ---------------------------------------------------------------------------
-- 6. Расчёт окон и подбор стола
-- ---------------------------------------------------------------------------

-- Самый маленький активный свободный стол (по capacity, затем по code).
CREATE OR REPLACE FUNCTION vm_pick_table(p_starts_at timestamptz, p_guests int)
RETURNS TABLE (table_id text, table_code text, table_capacity int)
LANGUAGE sql STABLE AS $$
  SELECT t."id", t."code", t."capacity"
  FROM "Table" t
  WHERE t."isActive"
    AND t."capacity" >= p_guests
    AND NOT EXISTS (
      SELECT 1 FROM "Booking" b
      WHERE b."tableId" = t."id"
        AND b."status" IN ('pending', 'confirmed')
        AND tstzrange(b."startsAt", b."endsAt") && tstzrange(p_starts_at, p_starts_at + vm_slot_duration())
    )
  ORDER BY t."capacity", t."code"
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION vm_user_busy(p_user_id text, p_starts_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Booking" b
    WHERE b."userId" = p_user_id
      AND b."status" IN ('pending', 'confirmed')
      AND tstzrange(b."startsAt", b."endsAt") && tstzrange(p_starts_at, p_starts_at + vm_slot_duration())
  )
$$;

-- Окна дня, доступные пользователю для p_guests гостей (spec.md, раздел 5).
-- p_user_id = NULL — без проверки «у пользователя уже есть бронирование на это время».
CREATE OR REPLACE FUNCTION vm_available_slots(p_user_id text, p_date date, p_guests int)
RETURNS TABLE (start_time text, starts_at timestamptz, ends_at timestamptz, table_id text, table_code text, table_capacity int)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_guests IS NULL OR p_guests < 1 OR p_guests > vm_max_guests() THEN
    PERFORM vm_fail('VM_INVALID_GUESTS');
  END IF;
  IF p_date IS NULL OR extract(isodow FROM p_date) = 1 OR NOT vm_in_horizon(p_date) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT s.slot, s.st, s.st + vm_slot_duration(), pt.table_id, pt.table_code, pt.table_capacity
    FROM (
      SELECT x.slot, x.ord, vm_slot_starts_at(p_date, x.slot) AS st
      FROM unnest(vm_slot_times()) WITH ORDINALITY AS x(slot, ord)
    ) s
    CROSS JOIN LATERAL vm_pick_table(s.st, p_guests) pt
    WHERE s.st > vm_now()
      AND NOT vm_is_closed(p_date, s.slot)
      AND (p_user_id IS NULL OR NOT vm_user_busy(p_user_id, s.st))
    ORDER BY s.ord;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Операции
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vm_create_booking(p_actor_id text, p_starts_at timestamptz, p_guests int)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
  v_time text;
  v_table record;
  v_id text;
  v_constraint text;
BEGIN
  PERFORM vm_actor_role(p_actor_id);
  PERFORM vm_set_actor(p_actor_id);

  IF p_guests IS NULL OR p_guests < 1 OR p_guests > vm_max_guests() THEN
    PERFORM vm_fail('VM_INVALID_GUESTS');
  END IF;
  IF p_starts_at IS NULL THEN
    PERFORM vm_fail('VM_INVALID_SLOT');
  END IF;

  v_date := vm_local_date(p_starts_at);
  v_time := vm_local_time(p_starts_at);

  IF date_trunc('minute', p_starts_at) <> p_starts_at OR NOT (v_time = ANY (vm_slot_times())) THEN
    PERFORM vm_fail('VM_INVALID_SLOT');
  END IF;
  IF extract(isodow FROM v_date) = 1 THEN
    PERFORM vm_fail('VM_MONDAY');
  END IF;
  IF NOT vm_in_horizon(v_date) THEN
    PERFORM vm_fail('VM_OUT_OF_HORIZON');
  END IF;
  IF p_starts_at <= vm_now() THEN
    PERFORM vm_fail('VM_SLOT_STARTED');
  END IF;
  IF vm_is_closed(v_date, v_time) THEN
    PERFORM vm_fail('VM_SLOT_CLOSED');
  END IF;
  IF vm_user_busy(p_actor_id, p_starts_at) THEN
    PERFORM vm_fail('VM_USER_OVERLAP');
  END IF;

  FOR v_table IN
    SELECT t."id", t."code", t."capacity" FROM "Table" t
    WHERE t."isActive" AND t."capacity" >= p_guests
    ORDER BY t."capacity", t."code"
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM "Booking" b
      WHERE b."tableId" = v_table."id" AND b."status" IN ('pending', 'confirmed')
        AND tstzrange(b."startsAt", b."endsAt") && tstzrange(p_starts_at, p_starts_at + vm_slot_duration())
    );
    BEGIN
      INSERT INTO "Booking" ("id", "userId", "tableId", "startsAt", "endsAt", "guests", "status", "createdAt", "updatedAt")
      VALUES (vm_new_id(), p_actor_id, v_table."id", p_starts_at, p_starts_at + vm_slot_duration(), p_guests, 'pending', vm_now(), vm_now())
      RETURNING "id" INTO v_id;
      EXIT;
    EXCEPTION WHEN exclusion_violation THEN
      -- гонка: стол или время пользователя заняли параллельно
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'Booking_user_no_overlap' THEN
        PERFORM vm_fail('VM_USER_OVERLAP');
      END IF;
    END;
  END LOOP;

  IF v_id IS NULL THEN
    PERFORM vm_fail('VM_NO_TABLE');
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION vm_change_booking_status(p_actor_id text, p_booking_id text, p_to "BookingStatus")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_staff boolean := vm_is_staff(vm_actor_role(p_actor_id));
  b "Booking"%ROWTYPE;
BEGIN
  PERFORM vm_set_actor(p_actor_id);

  SELECT * INTO b FROM "Booking" WHERE "id" = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM vm_fail('VM_BOOKING_NOT_FOUND');
  END IF;

  -- права: персонал — любые переходы по таблице; владелец — только отмена
  IF NOT v_staff AND NOT (b."userId" = p_actor_id AND p_to = 'cancelled') THEN
    PERFORM vm_fail('VM_FORBIDDEN');
  END IF;

  IF b."status" IN ('cancelled', 'completed', 'no_show') THEN
    PERFORM vm_fail('VM_TERMINAL_STATUS');
  END IF;
  IF NOT (
    (b."status" = 'pending'   AND p_to IN ('confirmed', 'cancelled')) OR
    (b."status" = 'confirmed' AND p_to IN ('cancelled', 'completed', 'no_show'))
  ) THEN
    PERFORM vm_fail('VM_INVALID_TRANSITION');
  END IF;

  IF p_to = 'cancelled' AND NOT v_staff THEN
    IF vm_now() > b."startsAt" - vm_cancel_deadline() THEN
      PERFORM vm_fail('VM_CANCEL_DEADLINE');
    END IF;
  ELSIF p_to IN ('confirmed', 'cancelled') THEN
    IF vm_now() >= b."startsAt" THEN
      PERFORM vm_fail('VM_WINDOW_STARTED');
    END IF;
  ELSIF p_to IN ('completed', 'no_show') THEN
    IF vm_now() < b."startsAt" THEN
      PERFORM vm_fail('VM_WINDOW_NOT_STARTED');
    END IF;
  END IF;

  UPDATE "Booking" SET "status" = p_to, "updatedAt" = vm_now() WHERE "id" = p_booking_id;
END $$;

CREATE OR REPLACE FUNCTION vm_set_user_role(p_actor_id text, p_target_id text, p_role "Role")
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_actor_role "Role" := vm_actor_role(p_actor_id);
  v_target_role "Role";
BEGIN
  IF v_actor_role <> 'super_admin' THEN
    PERFORM vm_fail('VM_FORBIDDEN');
  END IF;
  SELECT u."role" INTO v_target_role FROM "User" u WHERE u."id" = p_target_id FOR UPDATE;
  IF v_target_role IS NULL THEN
    PERFORM vm_fail('VM_USER_NOT_FOUND');
  END IF;
  IF v_target_role = 'super_admin' OR p_role = 'super_admin' OR p_role IS NULL THEN
    PERFORM vm_fail('VM_ROLE_PROTECTED');
  END IF;
  IF v_target_role = p_role THEN
    PERFORM vm_fail('VM_ROLE_UNCHANGED');
  END IF;
  PERFORM vm_set_actor(p_actor_id);
  UPDATE "User" SET "role" = p_role, "updatedAt" = now() WHERE "id" = p_target_id;
END $$;

CREATE OR REPLACE FUNCTION vm_close_slot(p_actor_id text, p_date date, p_start_time text, p_reason text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
BEGIN
  IF NOT vm_is_staff(vm_actor_role(p_actor_id)) THEN
    PERFORM vm_fail('VM_FORBIDDEN');
  END IF;
  PERFORM vm_set_actor(p_actor_id);
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 120 THEN
    PERFORM vm_fail('VM_INVALID_REASON');
  END IF;
  IF p_start_time IS NOT NULL AND NOT (p_start_time = ANY (vm_slot_times())) THEN
    PERFORM vm_fail('VM_INVALID_SLOT');
  END IF;
  IF p_date IS NULL OR extract(isodow FROM p_date) = 1 THEN
    PERFORM vm_fail('VM_MONDAY');
  END IF;
  IF NOT vm_in_horizon(p_date) THEN
    PERFORM vm_fail('VM_OUT_OF_HORIZON');
  END IF;
  IF EXISTS (SELECT 1 FROM "SlotClosure" c WHERE c."date" = p_date AND c."startTime" IS NULL)
     OR EXISTS (SELECT 1 FROM "SlotClosure" c WHERE c."date" = p_date AND c."startTime" = p_start_time) THEN
    PERFORM vm_fail('VM_CLOSURE_EXISTS');
  END IF;

  BEGIN
    INSERT INTO "SlotClosure" ("id", "date", "startTime", "reason", "createdById", "createdAt")
    VALUES (vm_new_id(), p_date, p_start_time, btrim(p_reason), p_actor_id, vm_now())
    RETURNING "id" INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM vm_fail('VM_CLOSURE_EXISTS');
  END;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION vm_open_slot(p_actor_id text, p_closure_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT vm_is_staff(vm_actor_role(p_actor_id)) THEN
    PERFORM vm_fail('VM_FORBIDDEN');
  END IF;
  PERFORM vm_set_actor(p_actor_id);
  DELETE FROM "SlotClosure" WHERE "id" = p_closure_id;
  IF NOT FOUND THEN
    PERFORM vm_fail('VM_CLOSURE_NOT_FOUND');
  END IF;
END $$;
