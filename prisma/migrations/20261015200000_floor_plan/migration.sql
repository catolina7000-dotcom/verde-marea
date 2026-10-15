-- Версия 2 (пет-проект): план зала и выбор стола гостем (spec.md: Table, раздел 5, 10а).
--
-- 1. Поля плана у "Table": shape, planX, planY, planW, planH (система координат 1000 × 640).
--    Источник раскладки — prisma/seed.ts (TABLES). Здесь те же значения проставляются уже
--    существующим столам T1…T8, чтобы миграция применялась и к заполненной базе версии 1.
-- 2. Правило выбора стола: активный, свободный в окно, guests ≤ capacity ≤ guests + 2.
--    Зеркало: lib/booking/rules.ts → TABLE_SLACK, tableFitsGuests().
-- 3. vm_table_availability — статус каждого стола в окне: free / busy / unsuitable / closed.
--    vm_day_availability — окна дня с числом свободных столов (полоса окон на /book).
-- 4. vm_create_booking получает необязательный p_table_id. Без него — поведение версии 1
--    (самый маленький подходящий стол). Стол не проходит правило → VM_TABLE_UNAVAILABLE;
--    гонку двух гостей за один стол по-прежнему ловит EXCLUDE Booking_table_no_overlap,
--    функция переводит её в тот же код.
-- Применённые миграции не меняются.

-- ---------------------------------------------------------------------------
-- 1. Поля плана
-- ---------------------------------------------------------------------------

ALTER TABLE "Table"
  ADD COLUMN "shape" TEXT NOT NULL DEFAULT 'round',
  ADD COLUMN "planX" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "planY" INTEGER NOT NULL DEFAULT 320,
  ADD COLUMN "planW" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN "planH" INTEGER NOT NULL DEFAULT 48;

UPDATE "Table" t SET
  "shape" = v.shape, "planX" = v.x, "planY" = v.y, "planW" = v.w, "planH" = v.h
FROM (VALUES
  ('T1', 'round', 210, 210,  56,  56),
  ('T2', 'round', 210, 350,  56,  56),
  ('T3', 'rect',  400, 210, 112,  72),
  ('T4', 'rect',  400, 350, 112,  72),
  ('T5', 'rect',  410, 505, 176,  80),
  ('T6', 'round', 720, 140,  56,  56),
  ('T7', 'round', 750, 290,  88,  88),
  ('T8', 'rect',  750, 490, 104, 200)
) AS v(code, shape, x, y, w, h)
WHERE t."code" = v.code;

-- Prisma-схема задаёт поля без значений по умолчанию: столы и план задаёт seed.
ALTER TABLE "Table"
  ALTER COLUMN "shape" DROP DEFAULT,
  ALTER COLUMN "planX" DROP DEFAULT,
  ALTER COLUMN "planY" DROP DEFAULT,
  ALTER COLUMN "planW" DROP DEFAULT,
  ALTER COLUMN "planH" DROP DEFAULT;

ALTER TABLE "Table"
  ADD CONSTRAINT "Table_shape_valid" CHECK ("shape" IN ('round', 'rect')),
  ADD CONSTRAINT "Table_plan_size" CHECK ("planW" BETWEEN 20 AND 400 AND "planH" BETWEEN 20 AND 400),
  ADD CONSTRAINT "Table_plan_round" CHECK ("shape" <> 'round' OR "planW" = "planH"),
  ADD CONSTRAINT "Table_plan_bounds" CHECK (
    "planX" - "planW" / 2 >= 0 AND "planX" + "planW" / 2 <= 1000 AND
    "planY" - "planH" / 2 >= 0 AND "planY" + "planH" / 2 <= 640
  );

-- ---------------------------------------------------------------------------
-- 2. Правило выбора стола гостем
-- ---------------------------------------------------------------------------

-- Сколько «лишних» мест допустимо при выборе стола на плане (двое не занимают стол на восемь).
CREATE OR REPLACE FUNCTION vm_table_slack() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;

CREATE OR REPLACE FUNCTION vm_table_fits(p_capacity int, p_guests int) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_guests <= p_capacity AND p_capacity <= p_guests + vm_table_slack()
$$;

CREATE OR REPLACE FUNCTION vm_table_busy(p_table_id text, p_starts_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Booking" b
    WHERE b."tableId" = p_table_id
      AND b."status" IN ('pending', 'confirmed')
      AND tstzrange(b."startsAt", b."endsAt") && tstzrange(p_starts_at, p_starts_at + vm_slot_duration())
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Статусы столов в окне и окна дня
-- ---------------------------------------------------------------------------

-- Статус каждого стола в окне p_starts_at для p_guests гостей (spec.md, раздел 5):
--   closed     — окно недоступно: прошло, закрыто (SlotClosure), понедельник, вне горизонта,
--                у пользователя уже есть активное бронирование на это время; или стол неактивен;
--   busy       — у стола есть активное бронирование, пересекающее окно;
--   unsuitable — не подходит по вместимости (нужно guests ≤ capacity ≤ guests + 2);
--   free       — можно выбрать.
-- p_user_id = NULL — без проверки занятости самого пользователя.
CREATE OR REPLACE FUNCTION vm_table_availability(p_user_id text, p_starts_at timestamptz, p_guests int)
RETURNS TABLE (
  table_id text, table_code text, zone text, capacity int, is_active boolean,
  shape text, plan_x int, plan_y int, plan_w int, plan_h int, status text
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_date date;
  v_time text;
  v_open boolean;
BEGIN
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

  v_open := extract(isodow FROM v_date) <> 1
    AND vm_in_horizon(v_date)
    AND p_starts_at > vm_now()
    AND NOT vm_is_closed(v_date, v_time)
    AND (p_user_id IS NULL OR NOT vm_user_busy(p_user_id, p_starts_at));

  RETURN QUERY
    SELECT t."id", t."code", t."zone", t."capacity", t."isActive",
           t."shape", t."planX", t."planY", t."planW", t."planH",
           CASE
             WHEN NOT v_open OR NOT t."isActive" THEN 'closed'
             WHEN vm_table_busy(t."id", p_starts_at) THEN 'busy'
             WHEN NOT vm_table_fits(t."capacity", p_guests) THEN 'unsuitable'
             ELSE 'free'
           END
    FROM "Table" t
    ORDER BY t."code";
END $$;

-- Окна дня для полосы окон: статус окна, число свободных подходящих столов (free по
-- vm_table_availability) и стол, который назначит автоподбор.
--   open       — окно можно бронировать (то же, что vm_available_slots версии 1);
--   past       — окно уже началось;
--   closed     — окно или день закрыты (SlotClosure);
--   user_busy  — у пользователя уже есть активное бронирование на это время;
--   full       — нет свободного активного стола с capacity ≥ guests.
-- Понедельник и дни вне горизонта — пустой результат, как у vm_available_slots.
CREATE OR REPLACE FUNCTION vm_day_availability(p_user_id text, p_date date, p_guests int)
RETURNS TABLE (
  start_time text, starts_at timestamptz, ends_at timestamptz, status text, free_tables int,
  auto_table_id text, auto_table_code text, auto_table_capacity int
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_guests IS NULL OR p_guests < 1 OR p_guests > vm_max_guests() THEN
    PERFORM vm_fail('VM_INVALID_GUESTS');
  END IF;
  IF p_date IS NULL OR extract(isodow FROM p_date) = 1 OR NOT vm_in_horizon(p_date) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT w.slot, w.st, w.st + vm_slot_duration(), w.state,
           CASE WHEN w.state = 'open' THEN (
             SELECT count(*)::int FROM vm_table_availability(p_user_id, w.st, p_guests) a WHERE a.status = 'free'
           ) ELSE 0 END,
           CASE WHEN w.state = 'open' THEN w.pick_id END,
           CASE WHEN w.state = 'open' THEN w.pick_code END,
           CASE WHEN w.state = 'open' THEN w.pick_capacity END
    FROM (
      SELECT s.slot, s.ord, s.st, pt.table_id AS pick_id, pt.table_code AS pick_code, pt.table_capacity AS pick_capacity,
             CASE
               WHEN s.st <= vm_now() THEN 'past'
               WHEN vm_is_closed(p_date, s.slot) THEN 'closed'
               WHEN p_user_id IS NOT NULL AND vm_user_busy(p_user_id, s.st) THEN 'user_busy'
               WHEN pt.table_id IS NULL THEN 'full'
               ELSE 'open'
             END AS state
      FROM (
        SELECT x.slot, x.ord, vm_slot_starts_at(p_date, x.slot) AS st
        FROM unnest(vm_slot_times()) WITH ORDINALITY AS x(slot, ord)
      ) s
      LEFT JOIN LATERAL vm_pick_table(s.st, p_guests) pt ON true
    ) w
    ORDER BY w.ord;
END $$;

-- ---------------------------------------------------------------------------
-- 4. vm_create_booking с необязательным p_table_id
-- ---------------------------------------------------------------------------

-- Новый необязательный параметр меняет сигнатуру: CREATE OR REPLACE с другим списком
-- аргументов создал бы перегрузку, и вызов с тремя аргументами стал бы неоднозначным.
-- Поэтому старая версия удаляется, новая создаётся с p_table_id DEFAULT NULL —
-- вызовы версии 1 (три аргумента) работают без изменений.
DROP FUNCTION IF EXISTS vm_create_booking(text, timestamptz, int);

CREATE FUNCTION vm_create_booking(p_actor_id text, p_starts_at timestamptz, p_guests int, p_table_id text DEFAULT NULL)
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

  -- Версия 2: гость выбрал стол на плане.
  IF p_table_id IS NOT NULL THEN
    SELECT t."id", t."capacity", t."isActive" INTO v_table FROM "Table" t WHERE t."id" = p_table_id;
    IF NOT FOUND
       OR NOT v_table."isActive"
       OR NOT vm_table_fits(v_table."capacity", p_guests)
       OR vm_table_busy(v_table."id", p_starts_at) THEN
      PERFORM vm_fail('VM_TABLE_UNAVAILABLE');
    END IF;
    BEGIN
      INSERT INTO "Booking" ("id", "userId", "tableId", "startsAt", "endsAt", "guests", "status", "createdAt", "updatedAt")
      VALUES (vm_new_id(), p_actor_id, v_table."id", p_starts_at, p_starts_at + vm_slot_duration(), p_guests, 'pending', vm_now(), vm_now())
      RETURNING "id" INTO v_id;
    EXCEPTION WHEN exclusion_violation THEN
      -- гонка: стол (Booking_table_no_overlap) или время пользователя заняли параллельно
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'Booking_user_no_overlap' THEN
        PERFORM vm_fail('VM_USER_OVERLAP');
      END IF;
      PERFORM vm_fail('VM_TABLE_UNAVAILABLE');
    END;
    RETURN v_id;
  END IF;

  -- Версия 1: самый маленький подходящий свободный стол (по capacity, затем по code).
  FOR v_table IN
    SELECT t."id", t."code", t."capacity" FROM "Table" t
    WHERE t."isActive" AND t."capacity" >= p_guests
    ORDER BY t."capacity", t."code"
  LOOP
    CONTINUE WHEN vm_table_busy(v_table."id", p_starts_at);
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
