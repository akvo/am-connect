<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>geology</Name>
    <UserStyle>
      <Title>Geological units by rock class</Title>
      <FeatureTypeStyle>
        <Rule>
          <Name>Sedimentary</Name>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>rock_class</ogc:PropertyName><ogc:Literal>Sedimentary</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PolygonSymbolizer><Fill><CssParameter name="fill">#f6d55c</CssParameter><CssParameter name="fill-opacity">0.75</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer>
        </Rule>
        <Rule>
          <Name>Igneous (intrusive)</Name>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>rock_class</ogc:PropertyName><ogc:Literal>Igneous (intrusive)</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PolygonSymbolizer><Fill><CssParameter name="fill">#ed553b</CssParameter><CssParameter name="fill-opacity">0.75</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer>
        </Rule>
        <Rule>
          <Name>Igneous (extrusive)</Name>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>rock_class</ogc:PropertyName><ogc:Literal>Igneous (extrusive)</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PolygonSymbolizer><Fill><CssParameter name="fill">#a3319f</CssParameter><CssParameter name="fill-opacity">0.75</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer>
        </Rule>
        <Rule>
          <Name>Metamorphic</Name>
          <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>rock_class</ogc:PropertyName><ogc:Literal>Metamorphic</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
          <PolygonSymbolizer><Fill><CssParameter name="fill">#3caea3</CssParameter><CssParameter name="fill-opacity">0.75</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer>
        </Rule>
        <Rule>
          <Name>Other</Name>
          <ElseFilter/>
          <PolygonSymbolizer><Fill><CssParameter name="fill">#20639b</CssParameter><CssParameter name="fill-opacity">0.75</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
