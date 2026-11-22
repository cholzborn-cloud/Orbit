

def test_apple_url_accepts_default_port_from_icloud():
    import pytest
    from orbitd.tools.calendar import CalError, apple_url
    assert apple_url("https://p52-caldav.icloud.com:443/1/calendars/") == "https://p52-caldav.icloud.com/1/calendars/"
    for bad in ("https://p52-caldav.icloud.com:8443/1/", "https://evil.example:443/1/", "http://caldav.icloud.com/1/"):
        with pytest.raises(CalError):
            apple_url(bad)
