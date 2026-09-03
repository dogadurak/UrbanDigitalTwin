"""The live path: a meter reading in, a scored insight out.

Three components have to agree on one contract, and they are in three files
that nothing forced to match:

    replay_service  publishes an IoTDevice with `energy` and weather
    setup_subscription  tells the broker which attributes to watch and forward
    main.fiware_notification  reads them off the notification

They did not agree. The subscription watched `temperature`, `humidity` and
`hvac_status` -- attributes nothing in this repository publishes -- and asked
the broker to forward those three. So no notification could fire, and one that
somehow did would have carried nothing the handler reads. The loop had never
run.

Nothing failed, because a subscription that never fires looks exactly like a
period with no anomalies.

These tests hold the three sides to the same list without needing a broker. The
end-to-end run against a real Orion-LD is in the README; what is automated here
is the part that silently rotted.
"""

import datetime

import pytest
import requests

from app import fiware_client as FC
from app import setup_subscription as SUB


# --------------------------------------------------------------------------
# The contract
# --------------------------------------------------------------------------

def test_the_subscription_watches_the_attribute_that_carries_a_reading():
    # `energy` is the event. Watching weather instead means a notification per
    # temperature tick and none when a meter reports.
    assert SUB.WATCHED_ATTRIBUTES == ["energy"]


def test_the_subscription_forwards_everything_the_handler_reads():
    """Every field `fiware_notification` unwraps must be in the notification."""
    import inspect

    from app import main as M

    source = inspect.getsource(M.fiware_notification)
    read_by_handler = {
        name for name in
        ("energy", "refRoom", "dateObserved", "airTemperature",
         "dewTemperature", "windSpeed", "cloudCoverage")
        if 'entity.get("{}"'.format(name) in source
    }
    assert read_by_handler, "the handler stopped reading the entity as expected"

    missing = read_by_handler - set(SUB.READING_ATTRIBUTES)
    assert not missing, (
        "the broker will not forward {}, so the handler will silently use its "
        "defaults -- which is a prediction against invented weather".format(missing)
    )


def test_the_replay_publishes_what_the_subscription_forwards():
    from replay import replay_service as RS

    device_id, body = RS._entity(
        "Bear_education_Yvette", "2017-07-15T15:00:00", 42.0,
        {"airTemperature": 28.0, "dewTemperature": 20.0,
         "windSpeed": 3.0, "cloudCoverage": 0.0},
    )
    assert body["type"] == "IoTDevice", "the subscription filters on this type"
    for name in SUB.READING_ATTRIBUTES:
        assert name in body, "{} is subscribed to but never published".format(name)


def test_the_handler_can_recover_the_building_id_from_what_the_replay_sends():
    from replay import replay_service as RS

    building = "Bear_education_Yvette"
    _, body = RS._entity(building, "2017-07-15T15:00:00", 42.0, {})
    ref = body["refRoom"]["object"]
    assert ref.split(":")[-1] == building


def test_a_missing_weather_column_is_omitted_rather_than_sent_as_null():
    from replay import replay_service as RS

    _, body = RS._entity("B", "2017-07-15T15:00:00", 42.0,
                         {"airTemperature": 28.0, "cloudCoverage": None})
    assert "airTemperature" in body
    assert "cloudCoverage" not in body, (
        "a null Property is not the same as an absent one to NGSI-LD; the "
        "handler's own default is the honest fallback"
    )


def test_the_reading_is_published_unaltered():
    """The feeder used to multiply every 50th reading by 2.5 'for demo purposes'."""
    from replay import replay_service as RS

    _, body = RS._entity("B", "2017-07-15T15:00:00", 3.2, {})
    assert body["energy"]["value"] == 3.2

    # The executable body only. The module docstring quotes the removed lines
    # as the explanation for why they are gone, and scanning that would make
    # this test fail for saying so.
    import inspect
    body = "".join(inspect.getsource(fn) for fn in (RS.run, RS._entity, RS.upsert))
    for tell in ("* 2.5", "Inject artificial", "spike", "% 50 =="):
        assert tell not in body, "the replay is altering readings again"


# --------------------------------------------------------------------------
# Publishing an insight
# --------------------------------------------------------------------------

class _Response:
    def __init__(self, status_code, text=""):
        self.status_code, self.text = status_code, text


def _publish(monkeypatch, response=None, exc=None):
    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        if exc:
            raise exc
        return response

    monkeypatch.setattr(FC.requests, "post", fake_post)
    return calls


ARGS = dict(target_room_id="urn:ngsi-ld:Building:B", insight_type="EnergyDeviation",
            severity="HIGH", anomaly_score=13.7, observed_value=81.2,
            expected_value=7.2, possible_cause="Over-consumption.",
            model_name="energy_cold_start", model_version="abc1234")


def test_a_published_insight_carries_what_an_engineer_needs_to_act(monkeypatch):
    calls = _publish(monkeypatch, _Response(201))
    FC.publish_ai_insight(**ARGS)

    body = calls[0][1]["json"]
    assert body["type"] == "AIInsight"
    assert body["refRoom"]["object"] == "urn:ngsi-ld:Building:B"
    # An alert saying only "HIGH" gives nobody a reason to send an engineer.
    for field in ("observedValue", "expectedValue", "anomalyScore",
                  "possibleCause", "model", "modelVersion", "severity"):
        assert body[field]["value"] is not None


def test_the_timestamp_is_timezone_aware(monkeypatch):
    calls = _publish(monkeypatch, _Response(201))
    FC.publish_ai_insight(**ARGS)
    stamp = calls[0][1]["json"]["detectedAt"]["value"]
    parsed = datetime.datetime.fromisoformat(stamp)
    assert parsed.tzinfo is not None, (
        "a naive UTC timestamp reads as local time to whatever parses it"
    )


def test_a_refusal_is_not_retried(monkeypatch):
    # The old client called raise_for_status() and retried everything, so a 400
    # cost three attempts over ten seconds and still failed.
    calls = _publish(monkeypatch, _Response(400, "bad payload"))
    with pytest.raises(FC.BrokerRejected):
        FC.publish_ai_insight(**ARGS)
    assert len(calls) == 1


def test_a_broker_error_is_retried(monkeypatch):
    calls = _publish(monkeypatch, _Response(503, "unavailable"))
    with pytest.raises(FC.BrokerUnavailable):
        FC.publish_ai_insight.retry_with(wait=None)(**ARGS)
    assert len(calls) == 3


def test_an_unreachable_broker_is_retried(monkeypatch):
    calls = _publish(monkeypatch, exc=requests.ConnectionError("refused"))
    with pytest.raises(FC.BrokerUnavailable):
        FC.publish_ai_insight.retry_with(wait=None)(**ARGS)
    assert len(calls) == 3


def test_detection_survives_a_broker_that_is_down(monkeypatch):
    """Publishing is best-effort; the client that asked still gets its answer."""
    from app import main as M

    def boom(**kwargs):
        raise FC.BrokerUnavailable("down")

    monkeypatch.setattr(M, "publish_ai_insight", boom)
    # main.detect_anomaly wraps the call in try/except for exactly this reason.
    import inspect
    source = inspect.getsource(M.detect_anomaly)
    assert "except Exception" in source and "publish_ai_insight" in source
