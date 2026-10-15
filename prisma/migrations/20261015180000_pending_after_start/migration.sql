-- spec.md, раздел 4 (изменение 2026-10-15): неподтверждённое бронирование не «зависает»
-- после начала окна. Персонал может:
--   pending   → confirmed            только до начала окна;
--   pending   → cancelled            в любое время;
--   confirmed → cancelled            только до начала окна;
--   pending/confirmed → completed    после начала окна;
--   pending/confirmed → no_show      после начала окна.
-- Владелец по-прежнему отменяет не позднее чем за 3 часа до начала.
-- Зеркало правил: lib/booking/rules.ts → staffCanTransition().

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
      (OLD."status" = 'pending'   AND NEW."status" IN ('confirmed', 'cancelled', 'completed', 'no_show')) OR
      (OLD."status" = 'confirmed' AND NEW."status" IN ('cancelled', 'completed', 'no_show'))
    ) THEN
      PERFORM vm_fail('VM_INVALID_TRANSITION');
    END IF;
    IF (NEW."status" = 'confirmed' OR (OLD."status" = 'confirmed' AND NEW."status" = 'cancelled'))
       AND vm_now() >= OLD."startsAt" THEN
      PERFORM vm_fail('VM_WINDOW_STARTED');
    END IF;
    IF NEW."status" IN ('completed', 'no_show') AND vm_now() < OLD."startsAt" THEN
      PERFORM vm_fail('VM_WINDOW_NOT_STARTED');
    END IF;
  END IF;
  RETURN NEW;
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

  -- права: персонал — переходы по таблице; владелец — только отмена
  IF NOT v_staff AND NOT (b."userId" = p_actor_id AND p_to = 'cancelled') THEN
    PERFORM vm_fail('VM_FORBIDDEN');
  END IF;

  IF b."status" IN ('cancelled', 'completed', 'no_show') THEN
    PERFORM vm_fail('VM_TERMINAL_STATUS');
  END IF;
  IF NOT (
    (b."status" = 'pending'   AND p_to IN ('confirmed', 'cancelled', 'completed', 'no_show')) OR
    (b."status" = 'confirmed' AND p_to IN ('cancelled', 'completed', 'no_show'))
  ) THEN
    PERFORM vm_fail('VM_INVALID_TRANSITION');
  END IF;

  IF p_to = 'cancelled' AND NOT v_staff THEN
    IF vm_now() > b."startsAt" - vm_cancel_deadline() THEN
      PERFORM vm_fail('VM_CANCEL_DEADLINE');
    END IF;
  ELSIF p_to = 'confirmed' OR (p_to = 'cancelled' AND b."status" = 'confirmed') THEN
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
