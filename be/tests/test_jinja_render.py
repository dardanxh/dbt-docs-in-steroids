from app.domain.ingestion.jinja_render import has_residual_jinja, render

REFS = {"orders": "`proj`.`dwh`.`orders`", "fx_rate": "`proj`.`dwh`.`fx_rate`"}
SOURCES = {("raw_erp", "tab_orders"): "`proj`.`raw`.`tab_orders`"}


def test_render_resolves_ref_source_and_strips_config():
    raw = (
        "{{ config(materialized='table', cluster_by=['a','b']) }}\n"
        "SELECT b.id, x.rate\n"
        "FROM {{ ref('orders') }} b\n"
        "JOIN {{ source('raw_erp', 'tab_orders') }} t ON t.id = b.id\n"
        "JOIN {{ ref('fx_rate') }} x ON x.id = b.id"
    )
    out = render(raw, REFS, SOURCES)
    assert not has_residual_jinja(out)
    assert "`proj`.`dwh`.`orders`" in out
    assert "`proj`.`raw`.`tab_orders`" in out
    assert "config(" not in out


def test_render_leaves_unknown_jinja_untouched():
    raw = "SELECT {{ my_macro('x') }} FROM {{ ref('orders') }}"
    out = render(raw, REFS, SOURCES)
    # ref resolved, but the custom macro remains → flagged as residual
    assert "`proj`.`dwh`.`orders`" in out
    assert has_residual_jinja(out)


def test_ref_unknown_name_is_left_as_is():
    raw = "SELECT * FROM {{ ref('does_not_exist') }}"
    out = render(raw, REFS, SOURCES)
    assert has_residual_jinja(out)
