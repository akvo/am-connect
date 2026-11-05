<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>tha_pd_2020_1km_UNadj</Name>
    <UserStyle>
      <Title>Population density (people per km2), log-like ramp</Title>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>0.85</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#000000" quantity="-99999" opacity="0" label="nodata"/>
              <ColorMapEntry color="#ffffcc" quantity="0" opacity="0" label="0"/>
              <ColorMapEntry color="#ffffcc" quantity="1" label="1"/>
              <ColorMapEntry color="#ffeda0" quantity="10" label="10"/>
              <ColorMapEntry color="#fed976" quantity="50" label="50"/>
              <ColorMapEntry color="#feb24c" quantity="100" label="100"/>
              <ColorMapEntry color="#fd8d3c" quantity="500" label="500"/>
              <ColorMapEntry color="#fc4e2a" quantity="1000" label="1,000"/>
              <ColorMapEntry color="#e31a1c" quantity="5000" label="5,000"/>
              <ColorMapEntry color="#800026" quantity="30000" label="30,000"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
