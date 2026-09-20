from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_toy_pages_are_served_from_independent_routes():
    chooser = client.get("/toys")
    sosexy = client.get("/toys/sosexy")
    svakom = client.get("/toys/svakom")

    assert chooser.status_code == 200
    assert sosexy.status_code == 200
    assert svakom.status_code == 200
    assert 'data-toy-profile="sosexy"' in chooser.text
    assert 'data-toy-profile="svakom"' in chooser.text

    for page in (sosexy.text, svakom.text):
        assert 'id="toyConnectionState"' in page
        assert 'id="toyConnectButton"' in page
        assert 'id="toyStopAllButton"' in page
        assert 'id="toySwitchLink"' in page

    assert '/static/toy-sosexy.js' in sosexy.text
    assert '/static/toy-svakom.js' not in sosexy.text
    assert '/static/toy-svakom.js' in svakom.text
    assert '/static/toy-sosexy.js' not in svakom.text
    for element_id in (
        "svakomStretchModes",
        "svakomVibrateModes",
        "svakomHeatControls",
        "svakomAdvancedPanel",
        "svakomCommandInput",
    ):
        assert f'id="{element_id}"' in svakom.text


def test_home_opens_the_toy_chooser_without_removing_chat_compatibility():
    home = client.get("/")
    chat = client.get("/chat")

    assert home.status_code == 200
    assert "url: '/toys'" in home.text

    assert client.get("/whisper").status_code == 200
    assert client.get("/whisper/sosexy").status_code == 200
    assert client.get("/whisper/svakom").status_code == 200
    assert chat.status_code == 200
    assert 'id="whisperModal"' in chat.text
