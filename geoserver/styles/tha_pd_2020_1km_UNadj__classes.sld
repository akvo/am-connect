<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink">
  <NamedLayer><Name>tha_pd_2020_1km_UNadj</Name><UserStyle><Title>Population density, 5 classes</Title>
    <FeatureTypeStyle><Rule><RasterSymbolizer><Opacity>0.85</Opacity>
      <ColorMap type="intervals">
        <ColorMapEntry color="#000000" quantity="-99999" label="nodata" opacity="0"/>
        <ColorMapEntry color="#ffffff" quantity="1" label="0 - 1" opacity="0"/>
        <ColorMapEntry color="#ffffb2" quantity="50" label="1 - 50 (rural)"/>
        <ColorMapEntry color="#fecc5c" quantity="300" label="50 - 300 (peri-urban)"/>
        <ColorMapEntry color="#fd8d3c" quantity="1500" label="300 - 1,500 (urban)"/>
        <ColorMapEntry color="#f03b20" quantity="5000" label="1,500 - 5,000 (dense urban)"/>
        <ColorMapEntry color="#bd0026" quantity="100000" label="> 5,000 (metropolitan core)"/>
      </ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle>
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>
